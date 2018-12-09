'use strict';

document.addEventListener('DOMContentLoaded', function() {
    updateUsersList();
    fillPopupData();

    stopTracking.addEventListener('click', function (event) {
        let parent = this.closest('.tracked-user');
        if (!parent) return;
        parent.classList.remove('active');
        sendMessage({message: 'stop_tracking'});
    });

    document.forms.nameForm.addEventListener('submit', function(event) {
        event.preventDefault();
        let input = this.userInput.value.trim();
        userInput.value = '';
        if (!input) return;

        userInput.value = '';
        username.innerText = input;
        let parent = username.closest('.tracked-user');
        if (!parent) return;

        parent.classList.add('active');
        sendMessage({message: 'track_new_user', username: input.toLowerCase()});
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
        chrome.storage.local.set({sound: this.value});
        playNotificationSound();
    });

    volume.addEventListener('change', function (event) {
        chrome.storage.local.set({volume: Number(this.value).toFixed(3)});
        playNotificationSound(this.value);
    });

    fontSize.addEventListener('input', function (event) {
        let newSize = Number(this.value);
        //console.log('input size: ' + this.value);
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
});

function sendMessage(messageObject, responseFunction = function(){}){
    chrome.tabs.query({active: true, currentWindow: true}, function(tabs) {
        chrome.tabs.sendMessage(tabs[0].id, messageObject, responseFunction);
    });
}

function sendMessageToAll(messageObject, responseFunction = function(){}){
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
            if (tabId in items.tabs && 'tracked_user' in items.tabs[tabId]) {
                username.innerText = items.tabs[tabId].tracked_user;
                username.closest('.tracked-user').classList.add('active');
            }
            //userInput.focus();
            if (items.sound_enabled !== true) {
                notification.checked = false;
                sound.closest('.indent').classList.add('disabled');
            }
            smartMention.checked = items.smart_mentions;

            volume.value = items.volume;

            fontSize.value = items.font_size ? items.font_size : Number(fontSize.min);
            fontSize.nextElementSibling.textContent = fontSize.value + ' px';

            showFontControls.checked = items.font_size_controls;

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
        audio.play().catch(err => {
            if (err instanceof DOMException && err.message === 'Failed to load because no supported source was found.') {
                // not sure what should we do. Maybe set selected sound to default.mp3
                console.log('Failed to load ' + audio.src);
            } else { throw err }
        });
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