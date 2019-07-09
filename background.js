chrome.runtime.onInstalled.addListener(function(details) {
    if (details.reason === 'install') {
        chrome.storage.local.set({
            color_scheme: '1',
            volume: 0.45,
            sound_enabled: false,
            sound: 'default.mp3',
            sound_list: ['default.mp3'], // filled with filenames from "sounds: directory later
            smart_mentions: true, // try to detect user mentions in chat without leading @ sign
            font_size: null, // null == default
            font_size_controls: false,
            hotkeys_enabled: true, //todo not sure if we need to ever disable them
            popup_info_viewed: false,
            first_time_launched: true,
            install_date: new Date().toString(),
            tabs: {} // tab_id: {tracked_user: null, ...}
        });
        getSoundsFilenames(names => {
            if (names.length) {
                chrome.storage.local.set({sound_list: names});
            }
        });
    } else if (details.reason === 'update') {
        // update available sounds and make sure that selected sound is still on the list
        getSoundsFilenames(names => {
            if (names.length) {
                chrome.storage.local.set({sound_list: names});
                chrome.storage.local.get('sound', items => {
                    if (!names.includes(items.sound)) {
                        chrome.storage.local.set({sound: 'default.mp3'});
                    }
                });
            }
        });
        /* const version = Number(details.previousVersion);
           if (version < 0.5) ... */
    }

    chrome.tabs.query({url: 'https://www.twitch.tv/*'}, function(tabs){
        tabs.forEach(tab => {
            try {
                chrome.tabs.executeScript(tab.id, { file: "content.js" });
                chrome.tabs.insertCSS(tab.id, { file: "content.css" })
            } catch (e) {}
        });
    });

    chrome.declarativeContent.onPageChanged.removeRules(undefined, function() {
        chrome.declarativeContent.onPageChanged.addRules([{
            conditions: [new chrome.declarativeContent.PageStateMatcher({
                pageUrl: {hostEquals: 'www.twitch.tv'},
            })],
            actions: [new chrome.declarativeContent.ShowPageAction()]
        }]);
    });
});

/** messages:
*  get_current_tab_id - content script asks for tab id in which it is running
*  get_chatters - request list of chatters from twitch API
*       - channel - name of the channel
*/
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    switch(request.message) {
        case 'get_current_tab_id':
            sendResponse({id: String(sender.tab.id)});
            break;
        case 'get_chatters':
            requestChatters(request.channel, sendResponse);
            return true;
    }
});

chrome.tabs.onUpdated.addListener(function(tabId, changeInfo, tab) {
    if (changeInfo.url) {
        chrome.tabs.sendMessage( tabId, {
            message: 'url_changed',
            url: changeInfo.url
        });
    }

    if (changeInfo.status === 'loading') {
        chrome.storage.local.get('tabs', value => {
            // clean info about current tab on page reload
            const curTabId = String(tabId);
            if (curTabId in value.tabs)
                delete value.tabs[curTabId];
            chrome.storage.local.set({tabs: value.tabs});


            //clean up old tabs info in storage in case it wasn't removed
            chrome.tabs.query({},function(tabs){
                let allIds = tabs.map(x => String(x.id));
                let ids = Object.keys(value.tabs);
                for (let i = 0; i < ids.length; i++) {
                    if (!allIds.includes(ids[i])) {
                        delete value.tabs[ids[i]];
                    }
                }
                chrome.storage.local.set({tabs: value.tabs});
            });
        });
    }
});

chrome.tabs.onRemoved.addListener(function (tabId) {
    chrome.storage.local.get('tabs', value => {
        delete value.tabs[tabId];
        chrome.storage.local.set({tabs: value.tabs});
    });
});

function getSoundsFilenames(callback) {
    chrome.runtime.getPackageDirectoryEntry(function(directoryEntry) {
        directoryEntry.getDirectory('sounds', {}, function(subDirectoryEntry) {
            let directoryReader = subDirectoryEntry.createReader();
            directoryReader.readEntries(function(entries) {
                let names = entries.map(x => x.name);
                // move default to the start of array
                const pos = names.indexOf('default.mp3');
                if (pos >= 0) {
                    names.splice(pos, 1);
                    names.unshift('default.mp3');
                }
                callback(names);
            });
        });
    });
}

/* if extension update ready in chrome store, send message to content scripts to go idle because they will become
"orphaned" after extension update and reload. */
chrome.runtime.onUpdateAvailable.addListener(function(details) {
    chrome.tabs.query({url: 'https://www.twitch.tv/*'}, function(tabs){
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, {message: 'update_coming'});
        });
        chrome.runtime.reload();
    });
});

function requestChatters(channelName, callbackResponse) {
    fetch(`https://tmi.twitch.tv/group/user/${channelName}/chatters`, {
        method: 'get',
        headers: new Headers(
            {
                "Content-Type": "application/json",
                "Accept": "application/json"
            }
        )
    })
        .then(response => response.json())
        .then(json => {
            const chatters = json.chatters;
            let chatUsers = [];
            if (!chatters.moderators.includes(channelName) && !chatters.vips.includes(channelName) &&
                !chatters.global_mods.includes(channelName) && !chatters.admins.includes(channelName) &&
                !chatters.staff.includes(channelName)) {
                chatUsers.push(channelName);
            }
            chatUsers = chatUsers.concat(
                chatters.admins,
                chatters.vips,
                chatters.global_mods,
                chatters.moderators,
                chatters.staff,
                chatters.viewers
            );
            callbackResponse({
                chatters: chatUsers,
                updated: Date.now()
            });
        }).catch(err => {});
}