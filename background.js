const DEFAULT_SETTINGS = {
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
    install_date: Date.now(),
    tabs: {}, // tab_id: {tracked_user: null, ...}

    /* since version 1.3 */
    detect_self_mention: false,
    self_mention_sound: 'appointed.ogg',
    self_mention_volume: 0.45,
    self_mention_in_active_tab: true,
    self_mention_show_notification: false,

    centralized_tracked_users_list: true,
    tracked_users: [],

    active_notifications: {}, // info about notification origin; { notificationId: { windowId:_, tabId:_ }, ... }
    hide_and_auto_click_points_bonus: true,
    hide_channel_leaderboard: false,
    hide_community_highlights: false,
    hide_extensions_overlay: false,
    disable_avatar_animation: false,
};

chrome.notifications.onClosed.addListener((id, byUser) => {
    chrome.storage.local.get('active_notifications', items => {
        if (items.active_notifications[id]) {
            delete items.active_notifications[id];
            chrome.storage.local.set({ active_notifications: items.active_notifications });
        }
    });
});

chrome.notifications.onButtonClicked.addListener((id, index) => {
    switch (index) {
        case 0: // go to tab
            chrome.storage.local.get('active_notifications', items => {
                const notificationInfo = items.active_notifications[id];
                if (notificationInfo) {
                    chrome.tabs.get(notificationInfo.tabId, tab => {
                        chrome.tabs.highlight({windowId:notificationInfo.windowId, tabs: [tab.index]}, () => {
                            chrome.windows.update(notificationInfo.windowId, { focused: true });
                        });
                    });
                }
                chrome.notifications.clear(id);
            });
            break;
        case 1: // close notification
            chrome.notifications.clear(id);
            break;
    }
});

chrome.notifications.onClicked.addListener(id => {
    chrome.notifications.clear(id);
});

chrome.runtime.onInstalled.addListener(function(details) {
    if (details.reason === 'install') {
        chrome.storage.local.set(DEFAULT_SETTINGS);
        getSoundsFilenames(names => {
            if (names.length) {
                chrome.storage.local.set({sound_list: names});
            }
        });
    } else if (details.reason === 'update') {
        // update chrome.local.storage if DEFAULT_SETTINGS contain new fields
        chrome.storage.local.get(null, storageSettings => {
            let newFields = {};
            Object.keys(DEFAULT_SETTINGS).forEach(key => {
                if (!(key in storageSettings))
                    newFields[key] = DEFAULT_SETTINGS[key];
            });
            if (Object.keys(newFields).length)
                chrome.storage.local.set(newFields);

            // fix for old versions, when "install_date" was a string generated with: new Date().toString()
            if (typeof storageSettings.install_date === 'string')
                chrome.storage.local.set({ install_date: new Date(storageSettings.install_date).getTime() });
        });

        // update available sounds and make sure that selected sound is still on the list
        getSoundsFilenames(names => {
            if (names.length) {
                chrome.storage.local.set({sound_list: names});
                chrome.storage.local.get(['sound', 'self_mention_sound'], items => {
                    if (!names.includes(items.sound)) {
                        chrome.storage.local.set({sound: 'default.mp3'});
                    }
                    if (!names.includes(items.self_mention_sound)) {
                        chrome.storage.local.set({self_mention_sound: 'default.mp3'});
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
*  user_was_mentioned - user was mentioned. Need to send response to play sound and add tab is to highlighted_tabs if needed
*  get_chatters - request list of chatters from twitch API
*       - channel - name of the channel
*  send_to_other_tabs - communication between context scripts. Relay message to all twitch tabs except the source one
*       - data - object to be relayed
*  play_sound - play audio file
*       - sound - file name
*       - volume - (Number) in range from 0 to 1 representing playback volume
 *      - dont_play_in_active_tab - (Boolean) flag signifying that sound shouldn't be played if message came from active tab/window
*/
chrome.runtime.onMessage.addListener(function(request, sender, sendResponse) {
    switch(request.message) {
        case 'get_current_tab_id':
            sendResponse({id: String(sender.tab.id)});
            break;
        case 'show_notification':
            chrome.windows.get(sender.tab.windowId, window => {
                if (!sender.tab.active || !window.focused) {
                    chrome.notifications.create({
                        type: 'basic',
                        title: '',
                        message: request.body,
                        contextMessage: `twitch.tv/${request.channel}`,
                        buttons: [
                            { title: 'Go to mentioned page' },
                            { title: 'Hide notification' },
                        ],
                        iconUrl: 'images/icon128.png',
                    }, notificationId => {
                        chrome.storage.local.get('active_notifications', items => {
                            items.active_notifications[notificationId] = {
                                windowId: sender.tab.windowId,
                                tabId: sender.tab.id,
                            };
                            chrome.storage.local.set({ active_notifications: items.active_notifications });
                        });
                    });
                }
            });
            break;
        case 'get_chatters':
            requestChatters(request.channel, sendResponse);
            return true;
        case 'send_to_other_tabs':
            chrome.tabs.query({url: 'https://www.twitch.tv/*'}, function(tabs){
                tabs.forEach(tab => {
                    if (tab.id !== sender.tab.id)
                        chrome.tabs.sendMessage(tab.id, { ...request.data });
                });
            });
            break;
        case 'play_sound':
            if (request.dont_play_in_active_tab) {
                chrome.windows.get(sender.tab.windowId, window => {
                    if (!sender.tab.active || !window.focused) {
                        playSound(request.sound, request.volume);
                    }
                });
            } else {
                playSound(request.sound, request.volume);
            }
            break;
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

function playSound(filename, volume) {
    const audio = new Audio(chrome.runtime.getURL(`./sounds/${filename}`));
    audio.volume = volume;
    audio.play().catch(err => {});
}