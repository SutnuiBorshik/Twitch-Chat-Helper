'use strict';

let trackedUsers = [];

document.addEventListener('DOMContentLoaded', function() {
    fillPopupData();
    bindEventListeners();
    updateUsersList();
});

function bindEventListeners() {
    stopTracking.addEventListener('click', clearTrackingUsersList );
    clearAll.addEventListener('click', clearTrackingUsersList );

    document.forms.nameForm.addEventListener('submit', function(event) {
        event.preventDefault();
        let input = this.userInput.value.trim();
        userInput.value = '';
        if (!input || trackedUsers.includes(input.toLowerCase())) return;

        username.innerText = input;
        const parent = username.closest('.tracked-user');
        parent.classList.add('active');

        trackedUsers.push(input.toLocaleLowerCase());

        trackedUsersCount.textContent = trackedUsers.length;
        document.querySelector('.tracked-users-list ol').appendChild(generateListElement(input));

        if (trackedUsers.length > 1) {
            parent.classList.remove('show');
        }

        sendMessage({message: 'add_user_to_track_list', username: input});
    });

    // remove user from tracking list
    const userListNode = document.querySelector('.tracked-users-list');
    userListNode.addEventListener('click', function(event) {
        const el = event.target;
        if (!el.classList || !el.classList.contains('stop-tracking-user')) return;
        const name = el.dataset.username;
        const index = trackedUsers.indexOf(name.toLocaleLowerCase());
        if (index === -1) return;

        if (trackedUsers.length === 1) {
            clearTrackingUsersList();
        } else {
            el.closest('li').remove();
            trackedUsers.splice(index, 1);
            trackedUsersCount.textContent = trackedUsers.length;

            if (trackedUsers.length === 1) {
                username.innerText = document.querySelector('.stop-tracking-user').dataset.username;
                username.closest('.tracked-user').classList.add('active', 'show');
                document.querySelector('.tracked-users').classList.remove('active');
            }

            sendMessage({message: 'remove_user_from_track_list', username: name});
        }
    });

    userInput.addEventListener('input', event => {
        updateUsersList();
        const input = event.target;
        if (input.value) {
            showSuggestions(input.value.trim().toLowerCase());
        } else {
            hideSuggestions();
        }
    });

    selfMention.addEventListener('change', function (event) {
        let indent = selfMentionSound.closest('.indent');
        chrome.storage.local.set({detect_self_mention: this.checked});
        if (indent) indent.classList.toggle('disabled');
    });

    selfMentionInActiveTab.addEventListener('change', function (event) {
        chrome.storage.local.set({self_mention_in_active_tab: !this.checked});
    });

    selfMentionShowNotification.addEventListener('change', function (event) {
        chrome.storage.local.set({self_mention_show_notification: this.checked});
    });

    selfMentionSound.addEventListener('change', function (event) {
        chrome.storage.local.set({self_mention_sound: this.value}, () => playSelfMentionSound());
    });

    selfMentionVolume.addEventListener('change', function (event) {
        chrome.storage.local.set({self_mention_volume: Number(this.value).toFixed(3)}, () => playSelfMentionSound(this.value));
    });

    playMentionSound.addEventListener('click', function (event) {
        this.classList.add('animated');
        playSelfMentionSound();
    });
    playMentionSound.addEventListener('transitionend', function (event) {
        if (event.target === this) //we don't want children transitions
            this.classList.remove('animated');
    });

    notification.addEventListener('change', function (event) {
        let indent = playSound.closest('.indent');
        chrome.storage.local.set({sound_enabled: this.checked});
        if (indent) indent.classList.toggle('disabled');
    });

    smartMention.addEventListener('change', function (event) {
        chrome.storage.local.set({smart_mentions: this.checked});
    });

    playSound.addEventListener('click', function (event) {
        this.classList.add('animated');
        playNotificationSound();
    });
    playSound.addEventListener('transitionend', function (event) {
        if (event.target === this) //we don't want children transitions
            this.classList.remove('animated');
    });

    sound.addEventListener('change', function (event) {
        chrome.storage.local.set({sound: this.value}, () => playNotificationSound());
    });

    volume.addEventListener('change', function (event) {
        chrome.storage.local.set({volume: Number(this.value).toFixed(3)}, () => playNotificationSound(this.value));
    });

    fontSize.addEventListener('input', function (event) {
        let newSize = Number(this.value);
        chrome.storage.local.set({font_size: newSize});
        fontSize.nextElementSibling.textContent = newSize + ' px';
        sendMessageToAll({message: 'font_size_change', size: newSize});
    });

    showFontControls.addEventListener('change', function (event) {
        chrome.storage.local.set({font_size_controls: this.checked});
        sendMessageToAll({message: 'font_size_controls', show: this.checked});
    });

    let colorSchemesContainer = document.querySelector('.color-schemes');
    colorSchemesContainer.addEventListener('click', function (event) {
        if (event.target.tagName !== 'A' && !event.target.parentElement.classList.contains('color-scheme')) return;

        let schemeNode = event.target.parentElement;
        if (schemeNode.classList.contains('selected')) return;

        let activeScheme = schemeNode.parentElement.querySelector('.color-scheme.selected');
        if (activeScheme) {
            activeScheme.classList.remove('selected');
        }
        schemeNode.classList.add('selected');
        let newSchemeIndex = schemeNode.dataset.scheme;
        chrome.storage.local.set({color_scheme: newSchemeIndex});
        sendMessageToAll({message: 'color_scheme_changed', scheme: newSchemeIndex});
    });

    centralizedTrackedUsersList.addEventListener('change', function (event) {
        chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
            chrome.storage.local.get(['tracked_users', 'tabs'], items => {
                if (event.target.checked) { //centralized => separate
                    chrome.storage.local.set({
                        centralized_tracked_users_list: false,
                        tracked_users: [],
                        tabs: items.tracked_users.length ? { [tabs[0].id]: { tracked_users: items.tracked_users } } : {}
                    }, () => sendMessageToAll( { message: 'reset' }));
                } else { //separate => centralized
                    chrome.storage.local.set({
                        centralized_tracked_users_list: true,
                        tracked_users: items.tabs[tabs[0].id] && items.tabs[tabs[0].id].tracked_users ? items.tabs[tabs[0].id].tracked_users : [],
                        tabs: {}
                    }, () => sendMessageToAll( { message: 'reset' }));
                }
            });
        });
    });

    claimChannelPointsBonus.addEventListener('change', function (event) {
        chrome.storage.local.set({ hide_and_auto_click_points_bonus: this.checked });
        sendMessageToAll({message: 'toggle_bonus_auto_claim', enable: this.checked});
    });

    hideChannelLeaderboard.addEventListener('change', function (event) {
        chrome.storage.local.set({ hide_channel_leaderboard: this.checked });
        sendMessageToAll({message: 'toggle_channel_leaderboard', show: !this.checked});
    });

    hideCommunityHighlights.addEventListener('change', function (event) {
        chrome.storage.local.set({ hide_community_highlights: this.checked });
        sendMessageToAll({message: 'toggle_community_highlights', show: !this.checked});
    });

    hideExtensionsOverlay.addEventListener('change', function (event) {
        chrome.storage.local.set({ hide_extensions_overlay: this.checked });
        sendMessageToAll({message: 'toggle_extensions_overlay', show: !this.checked});
    });

    disableAvatarAnimation.addEventListener('change', function (event) {
        chrome.storage.local.set({ disable_avatar_animation: this.checked });
        sendMessageToAll({message: 'toggle_avatar_animation', enable: !this.checked});
    });

    // bind click to show list of tracked users
    let showTrackedUsersButton = document.querySelector('.tracked-users-button');
    showTrackedUsersButton.addEventListener('click', function (event) {
        showTrackedUsersButton.closest('.tracked-users').classList.toggle('active');
    });

    // bind change active pane on bullet click
    let bulletsNode = document.querySelector('.bullets');
    bulletsNode.addEventListener('click', function (event) {
        const el = event.target;
        if (el.classList.contains('bullet') && !el.classList.contains('active')) {
            let activeBulletIndex = null;
            [...bulletsNode.children].forEach(node => {
                if (node === el) {
                    node.classList.add('active');
                    activeBulletIndex = [...bulletsNode.children].indexOf(node);
                } else {
                    node.classList.remove('active');
                }
            });

            const panesNode = document.querySelector('.panes');
            [...panesNode.children].forEach(node => node.classList.remove('active'));
            const newActivePane = panesNode.children[activeBulletIndex];
            if (newActivePane) newActivePane.classList.add('active');
        }
    });
}

function sendMessage(messageObject, responseFunction){
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, messageObject, responseFunction);
    });
}

function sendMessageToAll(messageObject, responseFunction){
    chrome.tabs.query({url: 'https://www.twitch.tv/*'}, function(tabs){
        tabs.forEach(tab => {
            chrome.tabs.sendMessage(tab.id, messageObject, responseFunction);
        });
    });
}

function fillPopupData() {
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.storage.local.get(null, items => {
            const tabId = String(tabs[0].id);
            let usernames = [];

            if (items.centralized_tracked_users_list) {
                usernames = items.tracked_users;
            } else {
                if (tabId in items.tabs && 'tracked_users' in items.tabs[tabId]) {
                    usernames = items.tabs[tabId].tracked_users;
                }
            }

            trackedUsers = usernames.map(name => name.toLowerCase());

            if (trackedUsers.length) {
                if (trackedUsers.length === 1) {
                    username.innerText = usernames[0];
                    username.closest('.tracked-user').classList.add('active');
                } else {
                    username.closest('.tracked-user').classList.remove('show');
                }
                trackedUsersCount.textContent = trackedUsers.length;
                const listNode = document.querySelector('.tracked-users-list ol');
                if (trackedUsers.length) {
                    const fragment = document.createDocumentFragment();
                    usernames.forEach(
                        name => fragment.appendChild(generateListElement(name))
                    );
                    listNode.appendChild(fragment);
                }
            }

            //userInput.focus();
            if (items.sound_enabled !== true) {
                notification.checked = false;
                sound.closest('.indent').classList.add('disabled');
            }
            volume.value = items.volume;
            smartMention.checked = items.smart_mentions;
            fontSize.value = items.font_size ? items.font_size : Number(fontSize.min);
            fontSize.nextElementSibling.textContent = fontSize.value + ' px';
            showFontControls.checked = items.font_size_controls;

            if (items.detect_self_mention !== true) {
                selfMention.checked = false;
                selfMentionSound.closest('.indent').classList.add('disabled');
            }
            selfMentionVolume.value = items.self_mention_volume;
            selfMentionShowNotification.checked = items.self_mention_show_notification;
            selfMentionInActiveTab.checked = !items.self_mention_in_active_tab;

            centralizedTrackedUsersList.checked = !items.centralized_tracked_users_list;
            claimChannelPointsBonus.checked = items.hide_and_auto_click_points_bonus;
            hideChannelLeaderboard.checked = items.hide_channel_leaderboard;
            hideCommunityHighlights.checked = items.hide_community_highlights;
            hideExtensionsOverlay.checked = items.hide_extensions_overlay;
            disableAvatarAnimation.checked = items.disable_avatar_animation;

            // fill <select> sound options
            let fragment = document.createDocumentFragment();
            items.sound_list.forEach(filename => {
                let option = document.createElement('option');
                option.value = filename;
                if (filename === items.sound)
                    option.selected = true;
                option.appendChild(document.createTextNode(filename.substring(0, filename.lastIndexOf('.'))));
                fragment.appendChild(option);
            });
            sound.appendChild(fragment);

            // fill <select> self mention sound options
            items.sound_list.forEach(filename => {
                let option = document.createElement('option');
                option.value = filename;
                if (filename === items.self_mention_sound)
                    option.selected = true;
                option.appendChild(document.createTextNode(filename.substring(0, filename.lastIndexOf('.'))));
                fragment.appendChild(option);
            });
            selfMentionSound.appendChild(fragment);

            let selectedEl = document.querySelector('.color-scheme.scheme' + items.color_scheme);
            let activeScheme;
            if (selectedEl) {
                activeScheme = selectedEl;
            } else {
                document.querySelector('.color-schemes').firstElementChild;
            }
            activeScheme.classList.add('selected', 'no-transition'); //cancel initial animation on popup creation
            setTimeout(()=>{activeScheme.classList.remove('no-transition');}, 50);

            if (items.popup_info_viewed === false) {
                let info_icon = document.querySelector('.info-icon-btn');
                if (info_icon) {
                    info_icon.classList.add('animated');
                    let handler = (event) => {
                        let el = event.currentTarget;
                        el.classList.remove('animated');
                        ['mouseover', 'click'].forEach(e => el.removeEventListener(e, handler));
                        chrome.storage.local.set({popup_info_viewed: true});
                    };
                    ['mouseover', 'click'].forEach(e => info_icon.addEventListener(e, handler));
                }
            }
        });
    });
}

function playNotificationSound(volume) {
    chrome.storage.local.get(['sound_enabled', 'sound', 'volume'], items => {
        if (!items['sound_enabled']) return;
        let vol = (volume === undefined) ? Number(items.volume) : Number(volume);
        if (vol === 0) return;

        let audio = new Audio('sounds/' + items.sound);
        audio.volume = vol;
        audio.play().catch(err => {});
    });
}

function playSelfMentionSound(volume) {
    chrome.storage.local.get(['detect_self_mention', 'self_mention_sound', 'self_mention_volume'], items => {
        if (!items['detect_self_mention']) return;
        let vol = (volume === undefined) ? Number(items.self_mention_volume) : Number(volume);
        if (vol === 0) return;

        let audio = new Audio('sounds/' + items.self_mention_sound);
        audio.volume = vol;
        audio.play().catch(err => {});
    });
}

function updateUsersList() {
    sendMessage({message: 'update_chat_users'});
}

function hideSuggestions() {
    suggestionsPopup.hidden = true;
    suggestionsPopup.firstElementChild.innerHTML = '';
    suggestionsPopup.dataset.selected = null;
    if (suggestionsPopup.dataset.keyHandler === 'true') {
        document.removeEventListener('keydown', suggestionKeydownHandler, true);
        suggestionsPopup.firstElementChild.removeEventListener('mouseover', suggestionsHoverHandler, true);
        document.removeEventListener('click', suggestionsClickHandler, true);
        suggestionsPopup.dataset.keyHandler = null;
    }
}

function showSuggestions(starts_with) {
    if (!starts_with) {
        hideSuggestions();
        return;
    }
    sendMessage({message: 'get_suitable_users', starts_with: starts_with}, suitableNames => {
        if (!suitableNames.length) {
            hideSuggestions();
            return;
        }
        let selectedPos = 0;
        if (suggestionsPopup.dataset.selected) {
            const pos = suitableNames.indexOf(suggestionsPopup.dataset.selected);
            if (pos !== -1) selectedPos = pos;
        }
        let fragment = document.createDocumentFragment();
        for (let i = 0; i < suitableNames.length; i++) {
            if (i === selectedPos) {
                suggestionsPopup.dataset.selected = suitableNames[i];
                fragment.appendChild(createSuggestionElement(suitableNames[i], true));
            } else {
                fragment.appendChild(createSuggestionElement(suitableNames[i]));
            }
        }
        const container = suggestionsPopup.firstElementChild;
        container.innerHTML = '';
        container.appendChild(fragment);
        if (suggestionsPopup.dataset.keyHandler !== 'true') {
            document.addEventListener('keydown', suggestionKeydownHandler, true);
            suggestionsPopup.firstElementChild.addEventListener('mouseover', suggestionsHoverHandler, true);
            document.addEventListener('click', suggestionsClickHandler, true);
            suggestionsPopup.dataset.keyHandler = 'true';
        }
        suggestionsPopup.hidden = false;
    });
}

function createSuggestionElement(name, selected = false) {
    const el = document.createElement('div');
    el.innerText = name;
    el.className = 'suggestion' + (selected ? ' selected-suggestion' : '');
    return el;
}

function suggestionKeydownHandler(event) {
    switch (event.code) {
        case 'ArrowUp': {
            const container = suggestionsPopup.firstElementChild;
            if (container.children.length <= 1) return;
            const selected = container.querySelector('.selected-suggestion');
            if (selected) {
                selected.classList.remove('selected-suggestion');
                const next = selected.previousElementSibling ? selected.previousElementSibling : container.lastElementChild;
                next.classList.add('selected-suggestion');
                suggestionsPopup.dataset.selected = next.textContent;
            }
            break;
        }
        case 'ArrowDown': {
            const container = suggestionsPopup.firstElementChild;
            if (container.children.length <= 1) return;
            const selected = container.querySelector('.selected-suggestion');
            if (selected) {
                selected.classList.remove('selected-suggestion');
                const next = selected.nextElementSibling ? selected.nextElementSibling : container.firstElementChild;
                next.classList.add('selected-suggestion');
                suggestionsPopup.dataset.selected = next.textContent;
            }
            break;
        }
        case 'Escape':
            hideSuggestions();
            break;
        case 'Enter':
        case 'NumpadEnter':
            const container = suggestionsPopup.firstElementChild;
            const selected = container.querySelector('.selected-suggestion');
            if (!selected) return;
            userInput.value = selected.textContent;
            hideSuggestions();
            break;
        default:
            return;
    }
    event.preventDefault();
    event.stopPropagation();
}

function suggestionsHoverHandler(event) {
    const el = event.target;
    if (el.classList.contains('suggestion') && !el.classList.contains('selected-suggestion')) {
        const selected = el.parentNode.querySelector('.selected-suggestion');
        if (selected) {
            selected.classList.remove('selected-suggestion');
        }
        suggestionsPopup.dataset.selected = el.textContent;
        el.classList.add('selected-suggestion');
        event.stopPropagation();
    }
}

function suggestionsClickHandler(event) {
    const el = event.target;
    if (el.classList.contains('suggestion')) {
        userInput.value = el.textContent;
        userInput.focus();
    }
    hideSuggestions();
}

function generateListElement(name) {
    const liNode = document.createElement('li');

    const spanUsername = document.createElement('span');
    spanUsername.innerText = name;
    spanUsername.className = 'username';

    const spanRemove = document.createElement('span');
    spanRemove.className = 'stop-tracking-user';
    spanRemove.dataset.username = name;

    liNode.appendChild(spanUsername);
    liNode.appendChild(spanRemove);

    return liNode;
}

function clearTrackingUsersList() {
    const userNode = document.querySelector('.tracked-user');
    userNode.classList.remove('active');
    userNode.classList.add('show');
    trackedUsers = [];
    const listNode = document.querySelector('.tracked-users-list');
    listNode.firstElementChild.innerHTML = '';
    listNode.classList.remove('active');
    sendMessage({message: 'stop_tracking_all'});
}