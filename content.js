'use strict';

let chat;
let chatContainer;
let chatInPopout = false;
let channelName;
let currentTabId;
let chatUsers = [];
let chatUsersLastUpdated;
let trackedUsers = [];
let trackedMessages = []; // [[msg1, msg_index1, trackbar_marker1], [msg2, msg_index2, trackbar_marker2], ...]
let trackedIndex = 0;
let trackBar;
let coef; // trackbar width to chat height ratio
let observer; //observing chat messages add/remove
let chatToggleObserver; //observing chat node hide/show
let updateUsersListInterval;
let clickChannelPointsBonusInterval;
let storageSettings = {};

let lastSelfMentionTimestamp;

waitForChat();
chrome.runtime.onMessage.addListener(messageHandler);

/** Handles incoming messages. Message types:
* reset - reset tracker without removing storage info
* url_changed - tab url changed; re-initiate tracker
*   - url - new tab url
* color_scheme_changed - user selected new scheme; update tracker styles and highlighted messages styles
*   - scheme - new color scheme's index
* stop_tracking_all - clear highlighted messages; hide trackbar
*   - stopMessagePropagation - block message emmit to prevent infinite message loop (Boolean)
* update_coming - stop all content script actions and go idle
* add_user_to_track_list - add user to tracking list
*   - username - new username to track
*   - updateStorage - sign if we need to update tracked list in storage(Boolean)
* remove_user_from_track_list - remove user from tracking list
*   - username - username to remove
*   - updateStorage - sign if we need to update tracked list in storage(Boolean)
* font_size_change - set new font-size and line-height for chat element
*   - size - new font size (Number)
* font_size_controls - show or hide font size controls at the bottom of chat
*   - show - either show or hide buttons (Boolean)
* update_chat_users - ask background script to request chatters list from twitch API
* get_suitable_users - return list of up to 5 users which nicknames start with certain symbols
*   - starts_with - starting symbols
* toggle_bonus_auto_claim - add body class to hide channel points bonus box, initiate auto click interval
*   - enable - (Boolean) enable or disable auto click
* toggle_channel_leaderboard - toggle body class to show/hide channel leaderboard
*   - show - (Boolean) state sign
* toggle_community_highlights - toggle body class to show/hide sub trains, polls, etc.
*   - show - (Boolean) state sign
* toggle_extensions_overlay - toggle body class to show/hide extensions overlay that appears on player hover
*   - show - (Boolean) state sign
* toggle_avatar_animation- toggle body class to enable/disable avatar animation
*   - enable - (Boolean) state sign
*/
function messageHandler(request, sender, response) {
    switch (request.message) {
        case 'reset':
            resetTracker(true);
            break;
        case 'url_changed':
            resetTracker();
            break;
        case 'color_scheme_changed':
            applyColorScheme(request.scheme);
            break;
        case 'stop_tracking_all':
            stopTracking(false, request.stopMessagePropagation);
            break;
        case 'update_coming':
            killContentScript();
            break;
        case 'add_user_to_track_list':
            addUserToTrackList(request.username, request.updateStorage);
            break;
        case 'remove_user_from_track_list':
            removeUserFromTrackList(request.username, request.updateStorage);
            break;
        case 'font_size_change':
            applyFontSize(request.size);
            break;
        case 'font_size_controls':
            toggleFontSizeControls(request.show);
            break;
        case 'update_chat_users':
            updateChatUsersList();
            break;
        case 'get_suitable_users':
            let names = findSuitableNames(request.starts_with);
            response(names);
            break;
        case 'toggle_bonus_auto_claim':
            toggleBonusAutoClaim(request.enable);
            break;
        case 'toggle_channel_leaderboard':
            toggleChannelLeaderboard(request.show);
            break;
        case 'toggle_community_highlights':
            toggleCommunityHighlights(request.show);
            break;
        case 'toggle_extensions_overlay':
            toggleExtensionsOverlay(request.show);
            break;
        case 'toggle_avatar_animation':
            toggleAvatarAnimation(request.enable);
            break;
    }
}

/** Completely restart tracker */
function resetTracker(leaveStorageEntry = false) {
    disableTracker(leaveStorageEntry);
    setTimeout(() => waitForChat(init), 1000);
}

/** When extension is about to be updated new content script will be re-inserted. This one should go idle */
function killContentScript() {
    stopTracking(true);
    disableTracker(true);
    chrome.storage.onChanged.removeListener(storageChangeHandler);
    chrome.runtime.onMessage.removeListener(messageHandler);
    if (chatToggleObserver) {
        chatToggleObserver.disconnect();
        chatToggleObserver = null;
    }
    if (observer) {
        observer.disconnect();
        observer = null;
    }
}

/** Reset global vars. Stop msg observer. Remove event listeners. Become completely idle */
function disableTracker(leaveStorageEntry) {
    if (observer)
        observer.disconnect();
    if (chat) {
        chat.removeEventListener('click', onClick);
        chat.removeEventListener('dblclick', blockDoubleClick, true);
        chat.removeEventListener('scroll', updateSlider);
        document.removeEventListener('keydown', onKeyDown);
    }
    if (trackBar && trackBar.isConnected)
        trackBar.remove();
    chat = null;
    if (chatContainer) {
        let prevScheme = chatContainer.dataset.tchColorScheme;
        if (prevScheme) {
            chatContainer.classList.remove(prevScheme);
            chatContainer.dataset.tchColorScheme = null;
        }
        chatContainer = null;
    }
    chatInPopout = false;
    channelName = null;
    chatUsers = [];
    chatUsersLastUpdated = null;
    trackedUsers = [];
    trackedMessages = [];
    trackedIndex = 0;
    trackBar = null;
    coef = null;
    observer = null;
    lastSelfMentionTimestamp = null;
    storageSettings = {};

    if (updateUsersListInterval) {
        clearInterval(updateUsersListInterval);
        updateUsersListInterval = null;
    }

    if (clickChannelPointsBonusInterval) {
        clearInterval(clickChannelPointsBonusInterval);
        clickChannelPointsBonusInterval = null;
    }

    if (!leaveStorageEntry) {
        removeTabInfoFromStorage();
    }
}

/** Stop tracking all users. If leaveStorageEntry is true then don't remove storage tab entry */
function stopTracking(leaveStorageEntry = false, stopMessagePropagation = false) {
    clearTrackedMessages();
    trackedUsers = [];
    hideTrackBar();
    if (storageSettings.centralized_tracked_users_list) {
        chrome.storage.local.set({ tracked_users: [] });
        if (!stopMessagePropagation) {
            chrome.runtime.sendMessage({
                message: 'send_to_other_tabs',
                data: {
                    message: 'stop_tracking_all',
                    stopMessagePropagation: true
                }
            });
        }
    } else if (!leaveStorageEntry) {
        removeTabInfoFromStorage();
    }
}

/** Waits until chat DOM is built and calls init() after */
function waitForChat() {
    const time0 = Date.now();
    const int = setInterval(() => {
        if (Date.now() - time0 > 10 * 1000) clearInterval(int);
        chat = document.querySelector('.chat-list .simplebar-scroll-content');
        if (chat) {
            clearInterval(int);
            init();
        }
    }, 500);
}

/** Initiates extension's functionality */
function init() {
    detectPopout();
    chatContainer = getChatContainer();
    chrome.storage.local.get(null, settings => {
        storageSettings = settings;
        chrome.storage.onChanged.addListener(storageChangeHandler);

        applyFontSize(settings.font_size);
        toggleFontSizeControls(settings.font_size_controls);
        applyColorScheme(settings.color_scheme);
        initiateObservers();
        observer.observe(chat, {childList: true, subtree: true});
        chatToggleObserver.observe(chat.closest('.chat-room').parentNode, {childList: true});
        if (settings.first_time_launched) {
            setColorSchemeOnFirstLaunch();
        }

        toggleBonusAutoClaim(settings.hide_and_auto_click_points_bonus);
        toggleChannelLeaderboard(!settings.hide_channel_leaderboard);
        toggleCommunityHighlights(!settings.hide_community_highlights);
        toggleExtensionsOverlay(!settings.hide_extensions_overlay);
        toggleAvatarAnimation(!settings.disable_avatar_animation);

        if (settings.centralized_tracked_users_list) {
            if (settings.tracked_users.length) {
                trackUsers(settings.tracked_users);
            }
        } else {
            // If extension updated and content script re-inserted we will have previously tracked username in storage by tab id.
            // We should start tracking that user again then.
            getTabId(id => {
                if (
                    settings.tabs && id in settings.tabs && Array.isArray(settings.tabs[id].tracked_users) &&
                    settings.tabs[id].tracked_users.length
                ){
                    trackUsers(settings.tabs[id].tracked_users);
                }
            });
        }
    });

    chat.addEventListener('click', onClick);
    chat.addEventListener('dblclick', blockDoubleClick, true);
    chat.addEventListener('scroll', updateSlider);
    document.addEventListener('keydown', onKeyDown);

    updateChatUsersList();
    updateUsersListInterval = setInterval(updateChatUsersList, 5 * 60 * 1000);
}

/** Sets callback function for mutation observers */
function initiateObservers() {
    // chat messages observer
    observer = new MutationObserver(mutations => {
        if (!trackedUsers.length && !storageSettings.detect_self_mention) return;

        for (let mutation of mutations) {
            if (!mutation.addedNodes.length) continue;
            let updateNeeded = false;

            mutation.addedNodes.forEach(node => {
                if (trackedUsers.length && node.classList && node.classList.contains('chat-line__message')) {
                    const el = node.querySelector('.chat-line__username');
                    if (el && trackedUsers.includes(el.textContent.toLowerCase())) {
                        const message = el.closest('.chat-line__message');
                        message.classList.add('tch-highlighted-message');
                        trackedMessages.push([message, trackedIndex++]);

                        if (storageSettings.sound_enabled) {
                            chrome.runtime.sendMessage({
                                message: 'play_sound',
                                sound: storageSettings.sound,
                                volume: storageSettings.volume,
                            });
                        }
                    }
                    updateNeeded = true;
                }
                if (storageSettings.detect_self_mention) {
                    let selfMention = node.querySelector('.mention-fragment--recipient');
                    if (selfMention) {
                        chrome.runtime.sendMessage({
                            message: 'play_sound',
                            sound: storageSettings.self_mention_sound,
                            volume: storageSettings.self_mention_volume,
                            dont_play_in_active_tab: !storageSettings.self_mention_in_active_tab
                        });
                        if (storageSettings.self_mention_show_notification) {
                            chrome.runtime.sendMessage({
                                message: 'show_notification',
                                channel: channelName,
                                body: buildMessageString(node),
                            });
                        }
                    }
                }
            });

            if (updateNeeded) {
                updateTrackBar();
            }
        }
    });
    // chat hide/show observer
    chatToggleObserver = new MutationObserver(mutations => {
        for (let mutation of mutations) {
            let newChatNodeAdded = false;
            if (mutation.addedNodes.length) {
                mutation.addedNodes.forEach(el => {
                    if (el.classList && el.classList.contains('chat-room')) {
                        newChatNodeAdded = true;
                    }
                });
            }
            if (newChatNodeAdded) {
                //re-init chat. But before that we need to disable old observer if it was initiated
                if (chatToggleObserver) {
                    chatToggleObserver.disconnect();
                    chatToggleObserver = null;
                }
                waitForChat(init);
            } else if (mutation.removedNodes.length) {
                let chatNodeRemoved = false;
                mutation.removedNodes.forEach(el => {
                    if (el.classList && el.classList.contains('chat-room')) {
                        chatNodeRemoved = true;
                    }
                });
                if (chatNodeRemoved) {
                    // stop tracking
                    stopTracking(true);
                    disableTracker(true);
                }
            }
        }
    });
}

/** Detects if chat is running in popout. Sets values of chatInPopout and channelName global variables */
function detectPopout() {
    let path = window.location.pathname;
    // remove arguments and anchor from path
    const questionMarkPos = path.indexOf('?');
    const hashTagPos = path.indexOf('#');
    if (questionMarkPos !== -1)
        path = path.slice(0, questionMarkPos);
    if (hashTagPos !== -1)
        path = path.slice(0, hashTagPos);

    path = path.toLowerCase().split('/');
    // popout path: /popout/channel_name/chat
    if (path[1]=== ('popout') && path[3] === ('chat')) {
        chatInPopout = true;
        channelName = path[2];
    } else {
        // except for popout, all other urls containing chat start with channel name
        channelName = path[1];
    }
}

// prevent chat name insertion on user-mention double click
function blockDoubleClick(event) {
    const target = event.target;
    if (target.dataset.aTarget === 'chat-message-mention')
        event.stopPropagation();
}

function onKeyDown(event) {
    if (event.altKey) {
        switch (event.code) {
            case 'KeyS': // stop stacking
                stopTracking();
                event.stopPropagation();
                break;
            case 'KeyW': // toggle focus on chat input field
                let textarea;
                if(!chatContainer || !(textarea = chatContainer.querySelector('textarea'))) return;
                if (textarea === document.activeElement) {
                    textarea.blur();
                } else {
                    textarea.focus();
                }
                event.stopPropagation();
                break;
        }
    } else if (event.ctrlKey && event.code === 'Enter') {
        const fullscreenBtn = document.querySelector('button[data-a-target="player-fullscreen-button"]');
        const player = document.querySelector('[data-a-target="player-overlay-click-handler"]');
        if (fullscreenBtn && player) {
            fullscreenBtn.dispatchEvent(new Event('click', {bubbles: true, cancelable: true}));
            player.focus(); //focus on player container to be able to pause/resume stream with spacebar
        }
        event.stopPropagation();
    }
}

/** Chat click handler. Detects if new user would be tracked. Conditions:
 *      - Alt+Click - track author of clicked message
 *      - Click on @mention - track mentioned username
 *      - Click on random word - if smart mention is on and clicked word is in chatUsers, than track that username
 * If clicked name has already been tracked then cancel tracking. */
function onClick(event) {
    const target = event.target;
    let name;
    if (event.altKey) {
        let tempNode;
        if ((tempNode = target.closest('.chat-line__message')) && (tempNode = tempNode.querySelector('.chat-line__username')))
            name = tempNode.textContent.trim();
    } else if (target.dataset.aTarget === 'chat-message-mention') {
        name = target.textContent.trim().slice(1);
        mentionClickAnimation(target);
    } else if (storageSettings.smart_mentions && (target.className === 'text-fragment' || target.parentNode.className === 'text-fragment')) {
        let text = '';
        let s = window.getSelection();
        if (s.isCollapsed && s.anchorNode.nodeType === Node.TEXT_NODE) {
            // select clicked word and assign it's value into variable
            s.modify('move', 'forward', 'character');
            s.modify('move', 'backward', 'word');
            s.modify('extend', 'forward', 'word');
            text = s.toString().trim();
            s.modify('move', 'forward', 'character'); //clear selection
            if (validateUsername(text) && chatUsers.includes(text)) {
                name = text;
            }
        }
    } else return;

    if (name) {
        if (!trackedUsers.includes(name.toLowerCase())) {
            addUserToTrackList(name);
        } else if (event.altKey) {
            removeUserFromTrackList(name);
        }
    }
}

/** Adds block with animation on top of @mention and adds event listener that removes it on animation end */
function mentionClickAnimation(node) {
    let el = document.createElement('span');
    el.className = 'tch-mention-animation';
    el.addEventListener('animationend', event => {event.currentTarget.remove()});
    node.appendChild(el);
}

/** Adds username to trackedUsers. Highlights his chat messages, adds them to trackedMessages.
 * Updates tracked users info in storage. Updates trackBar. */
function addUserToTrackList(newName, updateStorage = true) {
    const lowerCasedName = newName.toLowerCase();
    if (trackedUsers.includes(lowerCasedName)) return;
    trackedUsers.push(lowerCasedName);

    chat.querySelectorAll('.chat-line__username').forEach(el => {
        if (el.textContent.toLowerCase() === lowerCasedName) {
            const message = el.closest('.chat-line__message');
            message.classList.add('tch-highlighted-message');
            trackedMessages.push([message, trackedIndex++]);
        }
    });

    if (updateStorage) {
        if (storageSettings.centralized_tracked_users_list) {
            chrome.storage.local.get('tracked_users', items => {
                items.tracked_users.push(newName);
                chrome.storage.local.set({ tracked_users: items.tracked_users });
                chrome.runtime.sendMessage({
                    message: 'send_to_other_tabs',
                    data: {
                        message: 'add_user_to_track_list',
                        username: newName,
                        updateStorage: false
                    }
                });
            });
        } else {
            getTabId(id => {
                if (id === null) return;
                chrome.storage.local.get('tabs', items => {
                    if (id in items.tabs) {
                        items.tabs[id].tracked_users.push(newName);
                    } else {
                        items.tabs[id] = { tracked_users: [newName] };
                    }
                    chrome.storage.local.set({ tabs: items.tabs });
                });
            });
        }
    }

    updateTrackBar();
}

/** Removes username from trackedUsers and storage. Removes highlight from his messages. Updates trackBar.
 * If it was last tracking users - calls stopTracking */
function removeUserFromTrackList(name, updateStorage = true) {
    const lowerCasedName = name.toLowerCase();
    const index = trackedUsers.indexOf(lowerCasedName);
    if (index < 0) return;
    trackedUsers.splice(index, 1);

    if (trackedUsers.length) {
        trackedMessages = trackedMessages.filter(el => {
            const msgNode = el[0];
            if (msgNode.querySelector('.chat-line__username').textContent.toLowerCase() === lowerCasedName) {
                msgNode.classList.remove('tch-highlighted-message');
                if (trackBar)
                    trackBar.removeChild(el[2]);
                return false;
            }
            return true;
        });

        if (updateStorage) {
            if (storageSettings.centralized_tracked_users_list) {
                chrome.storage.local.get('tracked_users', items => {
                    items.tracked_users.splice(index);
                    chrome.storage.local.set({ tracked_users: items.tracked_users });
                    chrome.runtime.sendMessage({
                        message: 'send_to_other_tabs',
                        data: {
                            message: 'remove_user_from_track_list',
                            username: name,
                            updateStorage: false
                        }
                    });
                });
            } else {
                getTabId(id => {
                    if (id === null) return;
                    chrome.storage.local.get('tabs', items => {
                        if (id in items.tabs) {
                            items.tabs[id].tracked_users.splice(index);
                        }
                        chrome.storage.local.set({ tabs: items.tabs });
                    });
                });
            }
        }

        updateTrackBar();
    } else {
        stopTracking();
    }
}

/** Track and highlight messages of multiple users. Update trackBar. */
function trackUsers(list) {
    clearTrackedMessages();
    trackedUsers = list.map(name => name.toLowerCase());

    chat.querySelectorAll('.chat-line__username').forEach(el => {
        if (trackedUsers.includes(el.textContent.toLowerCase())) {
            const message = el.closest('.chat-line__message');
            message.classList.add('tch-highlighted-message');
            trackedMessages.push([message, trackedIndex++]);
        }
    });

    updateTrackBar();
}

/** Updates trackbar, slider and all markers on it according to trackedMessages */
function updateTrackBar() {
    calculateResizeCoef();
    if (!trackBar) trackBar = createTrackBar();
    for (let i = trackedMessages.length; i--;) {
        const message = trackedMessages[i][0];
        const marker = trackedMessages[i][2]; //marker html element or undefined if not created yet
        if (!message['isConnected']) {
            trackBar.removeChild(marker);
            trackedMessages.splice(i, 1);
        } else if (marker) {
            // update marker position and size
            const markerWidth = rescale(message.getBoundingClientRect().height);
            marker.style.left = rescale(message.offsetTop) + 'px';
            marker.style.width = (markerWidth < 3 ? 3 : markerWidth) + 'px';
        } else {
            // create marker
            const messageIndex = trackedMessages[i][1];
            let newMarker = document.createElement('div');
            newMarker.className = 'tch-trackbar-marker tch-trackbar-marker-' + messageIndex;
            const markerHeight = rescale(message.getBoundingClientRect().height);
            newMarker.style.cssText = `width:${markerHeight < 3 ? 3 : markerHeight}px; left:${rescale(message.offsetTop)}px`;
            trackedMessages[i].push(newMarker);
            trackBar.appendChild(newMarker);
        }
    }
    updateSlider();
    if (trackBar.hidden) trackBar.hidden = false;
}

/** Hides trackbar html element */
function hideTrackBar() {
    if (trackBar)
        trackBar.hidden = true;
}

/** Updates slider length and position in trackbar */
function updateSlider() {
    if (!trackedUsers.length || !trackBar) return;
    const slider = trackBar.querySelector('.tch-trackbar-slider');
    const sliderWidth = rescale(chat.getBoundingClientRect().height);
    slider.style.width = sliderWidth + 'px';
    slider.style.left = rescale(chat.scrollTop) + 'px';
}

/** Calculates and caches resize coefficient as relation of chat width to chat height */
function calculateResizeCoef() {
    const scrollHeight = chat.firstElementChild.getBoundingClientRect().height;
    coef = chat.parentNode.getBoundingClientRect().width / scrollHeight;
}

/** Rescales input size accordingly to resize coefficient */
function rescale(size) {
    if (!coef) calculateResizeCoef();
    return coef * size;
}

/** Creates trackbar with slider inside. Appends it to chatContainer */
function createTrackBar() {
    if ( !chatContainer ) return;

    const trackBar = document.createElement('div');
    trackBar.setAttribute('id', 'tch-trackbar');

    const slider = document.createElement('div');
    slider.className = 'tch-trackbar-slider';
    const sliderWidth = rescale(chat.getBoundingClientRect().height);
    slider.style.cssText = `width:${sliderWidth}px; left:${rescale(chat.scrollTop)}px`;
    trackBar.appendChild(slider);
    chatContainer.appendChild(trackBar);
    return trackBar;
}

/** Detects chat container element and returns it or null. Containers differ: default channel page, chat in popout
 * or chat in dashboard */
function getChatContainer() {
    let parent = null;
    if (chatInPopout) {
        parent = document.getElementById('root');
        if (parent)
            parent = parent.firstElementChild;
    } else {
        parent = document.querySelector('.right-column .stream-chat');
    }
    // try to check for chat on dashboard: https://www.twitch.tv/channel_name/dashboard/live
    if (!parent)
        parent = document.querySelector('.live-chat');
    return parent;
}

/** Removes highlight from tracked messages in chat; removes marks in trackbar; clears trackedMessages array */
function clearTrackedMessages() {
    trackedMessages.forEach(el => {
        el[0].classList.remove('tch-highlighted-message');
        if (trackBar)
            trackBar.removeChild(el[2]);
    });
    trackedMessages = [];
    trackedIndex = 0;
}

/** Checks if 60sec passed since last update. If it did then sends message to background script to get chat users list
 * from twitch API and saves them in chatUsers variable */
function updateChatUsersList() {
    const now = Date.now();
    if (chatUsersLastUpdated !== null && now - chatUsersLastUpdated < 60 * 1000) return;
    chatUsersLastUpdated = now;

    chrome.runtime.sendMessage({message: 'get_chatters', channel: channelName}, response => {
        if (!response) return;
        chatUsers = response.chatters;
        chatUsersLastUpdated = response.updated;
    })
}

/** Set new color scheme class for chatContainer */
function applyColorScheme(schemeIndex) {
    if (!chatContainer) return;
    let prevScheme = chatContainer.dataset.tchColorScheme;
    if (prevScheme) {
        chatContainer.classList.remove(prevScheme);
    }
    chatContainer.classList.add('tch-color-scheme' + schemeIndex);
    chatContainer.dataset.tchColorScheme = 'tch-color-scheme' + schemeIndex;
}

/** If tab id not cached, send request for tab ID to the background script, and execute callback with tab ID after */
function getTabId(callback) {
    if (currentTabId) {
        callback(currentTabId);
    } else {
        chrome.runtime.sendMessage({message:'get_current_tab_id'}, {},  response => {
            currentTabId = response.id;
            callback(currentTabId);
        });
    }
}

/** Removes tabs['current_tab_id'] from chrome's local storage */
function removeTabInfoFromStorage() {
    getTabId(id => {
        if (id === null) return;
        chrome.storage.local.get('tabs', items => {
            if (id in items.tabs) {
                delete items.tabs[id];
                chrome.storage.local.set({tabs: items.tabs});
            }
        });
    });
}

/** If input string meets twitch username requirements return true, otherwise false */
function validateUsername(string) {
    // 4 to 25 chars; alphanumeric and underscores; can't start with underscore
    const regexp = /^[^_\W]\w{3,24}$/;
    return regexp.test(string);
}

/** Sets font-size and line-height style properties for chat */
function applyFontSize(size) {
    if (size) {
        chat.style['font-size'] = size + 'px';
        chat.style['line-height'] = size > 17 ? (size + 2) + 'px' : null;
    } else {
        size = storageSettings.font_size;
        chat.style['font-size'] = size + 'px';
        chat.style['line-height'] = size > 17 ? (size + 2) + 'px' : null;
    }
}


/** Returns array of up to 5 nicknames from chatUsers that start with starts_with */
function findSuitableNames(starts_with) {
    let result = [];
    if (!chatUsers.length) return result;
    const users = Array.from(chatUsers);
    let found = 0;
    for (let i = 0; i < users.length; i++) {
        if (users[i].toLowerCase().startsWith(starts_with)) {
            result.push(users[i]);
            if (++found >= 5) break;
        }
    }
    return result;
}


/** Add or remove font size control button at chat bottom depending on show param
 * @param {Boolean} show */
function toggleFontSizeControls(show) {
    let container = chatContainer.querySelector('.chat-input__buttons-container');
    if (!container) return;
    container = container.firstElementChild;
    let buttons = container.querySelectorAll('.tch-font-size');
    if (show) {
        if (!buttons.length) { // don't bother if buttons already there
            const html = '<button class="tw-button-icon tw-interactive tch-font-size tch-font-minus" style="padding: 0 2px" title="Reduce font size"><span class="tw-button-icon__icon"><figure class="tw-svg"><svg class="tw-svg__asset tw-svg__asset--viewerlist tw-svg__asset--inherit" version="1.1" x="0px" y="0px" width="16px" height="16px" viewBox="0 0 121.805 121.804"><path d="M7.308,68.211h107.188c4.037,0,7.309-3.272,7.309-7.31c0-4.037-3.271-7.309-7.309-7.309H7.308    C3.272,53.593,0,56.865,0,60.902C0,64.939,3.272,68.211,7.308,68.211z" fill-rule="evenodd"></path></svg></figure></span></button><button class="tw-button-icon tw-interactive tch-font-size tch-font-plus" style="padding: 0 2px" title="Increase font size"><span class="tw-button-icon__icon"><figure class="tw-svg"><svg class="tw-svg__asset tw-svg__asset--viewerlist tw-svg__asset--inherit" version="1.1" x="0px" y="0px" width="16px" height="16px" viewBox="0 0 93.562 93.562"><path d="M87.952,41.17l-36.386,0.11V5.61c0-3.108-2.502-5.61-5.61-5.61c-3.107,0-5.61,2.502-5.61,5.61l0.11,35.561H5.61   c-3.108,0-5.61,2.502-5.61,5.61c0,3.107,2.502,5.609,5.61,5.609h34.791v35.562c0,3.106,2.502,5.61,5.61,5.61   c3.108,0,5.61-2.504,5.61-5.61V52.391h36.331c3.108,0,5.61-2.504,5.61-5.61C93.562,43.672,91.032,41.17,87.952,41.17z" fill-rule="evenodd"></path></svg></figure></span></button>';
            const handler = (event) => {
                let el = event.currentTarget;
                chrome.storage.local.get('font_size', values => {
                    const size = values.font_size || 13;
                    if (el.classList.contains('tch-font-plus')) {
                        if (size < 51) {
                            applyFontSize(size + 1);
                            chrome.storage.local.set({font_size: size + 1})
                        }
                    } else {
                        if (size > 13) {
                            applyFontSize(size - 1);
                            chrome.storage.local.set({font_size: size - 1})
                        }
                    }
                    el.blur();
                });
            };
            let temp = document.createElement('div');
            temp.innerHTML = html;
            temp.firstElementChild.addEventListener('click', handler);
            temp.lastElementChild.addEventListener('click', handler);
            container.appendChild(temp.firstElementChild);
            container.appendChild(temp.lastElementChild);
        }
    } else {
        buttons.forEach(node => {
            node.remove();
        });
    }
}

/** Runs on script first injection. Set's dark color scheme if "dark mode" was enabled on twitch */
function setColorSchemeOnFirstLaunch() {
    if (document.body.classList.contains('dark-theme')) {
        chrome.storage.local.set({ color_scheme: '4' });
        applyColorScheme(4);
    }
    chrome.storage.local.set({ first_time_launched: false });
}

//todo add tracking in VODs

/** Maintain local copy of chrome.storage up to date */
function storageChangeHandler(changes, area) {
    if (area === 'local') {
        Object.keys(changes).forEach(key => {
            storageSettings[key] = changes[key].newValue;
        });
    }
}

function toggleBonusAutoClaim(active) {
    const CLASS_NAME = 'tch-hide-channel-points-box';
    if (active) {
        document.body.classList.add(CLASS_NAME);
        clickChannelPointsBonusInterval = setInterval(clickPointsClaimBox, 5 * 1000);
    } else {
        document.body.classList.remove(CLASS_NAME);
        if (clickChannelPointsBonusInterval !== null) {
            clearInterval(clickChannelPointsBonusInterval);
            clickChannelPointsBonusInterval = null;
        }
    }
}

function toggleChannelLeaderboard(show) {
    toggleBodyClass(show, 'tch-hide-channel-leaderboard');
}

function toggleCommunityHighlights(show) {
    toggleBodyClass(show, 'tch-hide-community-highlights');
}

function toggleExtensionsOverlay(show) {
    toggleBodyClass(show, 'tch-hide-extensions-overlay');
}

function toggleAvatarAnimation(show) {
    toggleBodyClass(show, 'tch-disable-avatar-animations');
}

function toggleBodyClass(remove, className) {
    if (remove) {
        document.body.classList.remove(className);
    } else {
        document.body.classList.add(className);
    }
}

function clickPointsClaimBox() {
    const iconNode = chatContainer.querySelector('.claimable-bonus__icon');
    if (iconNode) {
        const claimButton = iconNode.closest('button');
        if (claimButton) claimButton.click();
    }
}

function buildMessageString(node) {
    let result = '';
    Array.from(node.children).forEach(childNode => {
        if (childNode.classList.contains('chat-line__message--emote-button')) {
            const img = childNode.querySelector('.chat-line__message--emote');
            if (img && img.alt) {
                result += img.alt;
            }
        } else if (!childNode.classList.contains('chat-line__timestamp')) {
            result += childNode.textContent;
        }
    });

    return result;
}