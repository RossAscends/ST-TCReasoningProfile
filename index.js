const {
    eventSource,
    event_types,
} = SillyTavern.getContext();

import { saveSettingsDebounced, saveChat, stopGeneration } from '../../../../script.js';
import { delay } from '../../../utils.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { waitUntilCondition } from '../../../utils.js';

const LOG_PREFIX = '[ST-TCReasoningProfile]';
const EXTENSION_PATH = 'scripts/extensions/third-party/ST-TCReasoningProfile';

const $connectionProfilesSelect = $('#connection_profiles');

let activeConnectionProfileName = null;
let isReasoningProfileSwappedOn = false;
let isExtensionActive = false;
let isAppLoading = true;

let isMidGenerationCycle = false;
let isAutoContinuing = false;
let isProfileSwapping = false;

let triggerType = 'GENERATION_STARTED';

let settings = {};

function initExtSettings() {
    extension_settings.customReasoning = extension_settings.customReasoning || {};
    extension_settings.customReasoning.reasoningProfileID = extension_settings.customReasoning.reasoningProfileID || 'None';
    extension_settings.customReasoning.reasoningProfileName = extension_settings.customReasoning.reasoningProfileName || 'None';
    extension_settings.customReasoning.autoContinueAfterReasoning = extension_settings.customReasoning.autoContinueAfterReasoning || false;
    extension_settings.customReasoning.onlyTriggerWhenUserLast = extension_settings.customReasoning.onlyTriggerWhenUserLast || false;
    extension_settings.customReasoning.isExtensionActive = extension_settings.customReasoning.isExtensionActive || false;
    extension_settings.customReasoning.postReasoningPrefix = extension_settings.customReasoning.postReasoningPrefix || '\n ';

}

function getExtSettings() {
    return extension_settings.customReasoning;
}

function addConnectionProfilesToExtension() {

    if (!$('connection_profiles')) return;

    //console.warn('Adding connection profiles to extension selector');
    const context = getContext();
    const profiles = context.extensionSettings?.connectionManager?.profiles || [];
    const $extensionSelector = $('#reasoningProfileSelector');
    //console.warn(`Found ${profiles.length} connection profiles`);
    $extensionSelector.append('<option value="None">None</option>');
    for (const profile of profiles) {
        $extensionSelector.append(`<option value="${profile.id}">${profile.name}</option>`);
    }
    $extensionSelector.val(extension_settings.customReasoning.reasoningProfileID).trigger('change');
    $extensionSelector.off('change').on('change', () => updateExtensionSettings());

}

async function updateExtensionSettings() {
    const $extensionSelector = $('#reasoningProfileSelector');
    const profileName = $extensionSelector.find('option:selected').text();
    const profileID = $extensionSelector.find('option:selected').val();
    console.info(` ${LOG_PREFIX} Updating reasoning profile to "${profileName}"`);
    extension_settings.customReasoning.reasoningProfileID = profileID;
    extension_settings.customReasoning.reasoningProfileName = profileName;
    await saveSettingsDebounced();
}

async function swapToReasoningProfile() {

    if (extension_settings.customReasoning.reasoningProfile == 'None') {
        console.warn(LOG_PREFIX, 'No reasoning profile selected');
        isReasoningProfileSwappedOn = false;
        return;
    }

    activeConnectionProfileName = $connectionProfilesSelect.find('option:selected').text();
    console.debug(`${LOG_PREFIX} Saving active main profile as "${activeConnectionProfileName}" for later reversion.`);
    isProfileSwapping = true;
    isReasoningProfileSwappedOn = true;
    console.debug(`${LOG_PREFIX} Swapping to reasoning profile ${extension_settings.customReasoning.reasoningProfileName}`);
    try {

        const targetNode = document.querySelector('.online_status_indicator');
        const config = { attributes: true, attributeFilter: ['class'] };
        let apiIsOnline = false
        const callback = function (mutationsList, observer) {
            for (let mutation of mutationsList) {
                if (mutation.attributeName === 'class' && mutation.target.classList.contains('success')) {
                    console.log('Class "success" added to #online_status_indicator');
                    apiIsOnline = true
                }
            }
        };
        const observer = new MutationObserver(callback);
        observer.observe(targetNode, config);
        apiIsOnline = false

        await SlashCommandParser.commands['profile'].callback(
            {
                await: 'true',
                _scope: null, // or a valid SlashCommandScope instance
                _abortController: null, // or a valid SlashCommandAbortController instance
            },
            extension_settings.customReasoning.reasoningProfileName,
        );

        await new Promise(resolve => waitUntilCondition(() => apiIsOnline).then(() => {
            console.debug(`${LOG_PREFIX} Reasoning profile swap complete and API online`);
            resolve();
            observer.disconnect();
            isProfileSwapping = false;
        }));

    } catch (error) {
        console.error(`Failed to swap to reasoning profile: ${error}`);
    }
}

async function swapToOriginalProfile() {
    console.debug(`${LOG_PREFIX} Swapping back to original profile: "${activeConnectionProfileName}"`);
    isProfileSwapping = true;
    try {

        const targetNode = document.querySelector('.online_status_indicator');
        const config = { attributes: true, attributeFilter: ['class'] };
        let apiIsOnline = false
        const callback = function (mutationsList, observer) {
            for (let mutation of mutationsList) {
                if (mutation.attributeName === 'class' && mutation.target.classList.contains('success')) {
                    console.log('Class "success" added to #online_status_indicator');
                    apiIsOnline = true
                }
            }
        };
        const observer = new MutationObserver(callback);
        observer.observe(targetNode, config);
        apiIsOnline = false

        await SlashCommandParser.commands['profile'].callback(
            {
                await: 'true',
                _scope: null, // or a valid SlashCommandScope instance
                _abortController: null, // or a valid SlashCommandAbortController instance
            },
            activeConnectionProfileName,
        );

        await new Promise(resolve => waitUntilCondition(() => apiIsOnline).then(() => {
            console.debug(`${LOG_PREFIX} Original profile swap complete and API online`);
            resolve();
            observer.disconnect();
            isReasoningProfileSwappedOn = false;
            isProfileSwapping = false;
        }));

    } catch (error) {
        console.error(`Failed to swap to reasoning profile: ${error}`);
    }
}

function shouldSkipIfNotUserLast() {
    let onlyTriggerWhenUserLast = extension_settings.customReasoning.onlyTriggerWhenUserLast;
    let chat = getContext().chat;
    let lastMes = chat[chat.length - 1];
    console.debug(`${LOG_PREFIX} lastMes: ${JSON.stringify(lastMes.mes)}`);
    let lastMesIsUser = lastMes.is_user
    let shouldSkip = !lastMesIsUser && onlyTriggerWhenUserLast;
    console.debug(`${LOG_PREFIX} lastMesIsUser: ${lastMesIsUser}, onlyTriggerWhenUserLast: ${onlyTriggerWhenUserLast}, shouldSkip: ${shouldSkip}`);
    return shouldSkip
}

function checkIfLastMesIsByUser() {
    let lastMesIsUser
    let { chat } = getContext();
    let lastMes = chat[chat.length - 1];
    console.warn(`${LOG_PREFIX} lastMes: ${JSON.stringify(lastMes.mes)}`);
    lastMesIsUser = lastMes.is_user
    console.warn(`${LOG_PREFIX} lastMesIsUser: ${lastMesIsUser}`);

    return lastMesIsUser
}

function setAppropriateTriggerType() {
    let onlyTriggerOnUserMessage = extension_settings.customReasoning.onlyTriggerWhenUserLast;
    if (onlyTriggerOnUserMessage) {
        triggerType = 'USER_MESSAGE_RENDERED';
    } else {
        triggerType = 'GENERATION_STARTED';
    }
    console.warn(`${LOG_PREFIX} Trigger type set to ${triggerType}`);
}

function toggleExtensionState(state) {
    const $activeToggle = $('#customReasoningPowerButton');
    //console.warn(`Toggling extension active state to ${state}`);
    $activeToggle.toggleClass('toggleEnabled', state);
    extension_settings.customReasoning.isExtensionActive = state;
    saveSettingsDebounced();
}

(async function () {

    //console.warn('Custom Reasoning extension loaded');
    const settingsHtml = await $.get(`${EXTENSION_PATH}/settings.html`);
    $('#extensions_settings').append(settingsHtml);

    const $extensionSelector = $('#reasoningProfileSelector');
    const $activeToggle = $('#customReasoningPowerButton');
    const $autoContinue = $('#autoContinueAfterReasoning'); //checkbox
    const $postReasoningPrefix = $('#postReasoningPrefix');
    const $onlyTriggerWhenUserLast = $("#onlyTriggerWhenUserLast");

    settings = getExtSettings();
    let isAnySettingNull = false;
    let whichSetting = null;

    if (settings) {
        for (const [key, value] of Object.entries(settings)) {
            if (value === null) {
                isAnySettingNull = true;
                whichSetting = key;
                break;
            }
        }
    }

    if (!settings || isAnySettingNull) {
        console.warn(`${LOG_PREFIX} No settings found, or something was Null (${whichSetting}); initializing`);
        initExtSettings();
        settings = getExtSettings();
    }

    console.warn(`${LOG_PREFIX} Extension settings ready: ${JSON.stringify(settings)}`);

    eventSource.once(event_types.APP_READY, () => {
        addConnectionProfilesToExtension();
        $extensionSelector.val(settings.reasoningProfileID).trigger('change');
        $autoContinue.prop('checked', settings.autoContinueAfterReasoning);
        $onlyTriggerWhenUserLast.prop('checked', settings.onlyTriggerWhenUserLast);
        $postReasoningPrefix.val(settings.postReasoningPrefix);
        isExtensionActive = settings.isExtensionActive;
        activeConnectionProfileName = $connectionProfilesSelect.find('option:selected').text();
        console.debug(`${LOG_PREFIX} onLoad active connection profile is: ${activeConnectionProfileName}`);
        toggleExtensionState(isExtensionActive);
        setAppropriateTriggerType();
        isAppLoading = false;
        console.warn(`${LOG_PREFIX} Extension setup complete.`);
    });

    $activeToggle.off('click').on('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        isExtensionActive = !isExtensionActive;
        toggleExtensionState(isExtensionActive);
    });

    $autoContinue.off('click').on('click', (e) => {
        extension_settings.customReasoning.autoContinueAfterReasoning = !extension_settings.customReasoning.autoContinueAfterReasoning;
        saveSettingsDebounced();
    });

    $onlyTriggerWhenUserLast.off('click').on('click', (e) => {
        extension_settings.customReasoning.onlyTriggerWhenUserLast = !extension_settings.customReasoning.onlyTriggerWhenUserLast;
        setAppropriateTriggerType();
        saveSettingsDebounced();
    })

    $postReasoningPrefix.off('change').on('change', (e) => {
        extension_settings.customReasoning.postReasoningPrefix = $postReasoningPrefix.val();
        saveSettingsDebounced();
    });

    //MARK:OnMessageStart
    eventSource.on(event_types[triggerType], async () => {
        console.warn(`Generation started; triggerType: ${triggerType}, isMidGenerationCycle? ${isMidGenerationCycle}, isAutoContinuing? ${isAutoContinuing}`);

        if (!isExtensionActive) return;
        if (isAppLoading) return;

        let triggerOnlyWhenUserLast = extension_settings.customReasoning.onlyTriggerWhenUserLast;

        let isLastMesByUser = null

        isLastMesByUser = checkIfLastMesIsByUser();

        /*         await waitUntilCondition(() => isLastMesByUser !== null).then(() => {
                    console.warn(`${LOG_PREFIX} Got isLastMesByUser: ${isLastMesByUser}`);
                }); */

        console.warn(`${LOG_PREFIX} triggerOnlyWhenUserLast: ${triggerOnlyWhenUserLast}, isLastMesByUser: ${isLastMesByUser}`);
        if (triggerOnlyWhenUserLast && isLastMesByUser === false) {
            console.warn(`${LOG_PREFIX} Skipping generation because last message is not by user`);
            return
        }

        isMidGenerationCycle = true;

        if (!isReasoningProfileSwappedOn && isExtensionActive && !isAutoContinuing) {
            console.warn(LOG_PREFIX, 'Swapping to reasoning Profile');
            await swapToReasoningProfile();
            eventSource.once(event_types.STREAM_REASONING_DONE, async () => {
                console.warn(LOG_PREFIX, 'STREAM_REASONING_DONE, stopping Generation.');
                stopGeneration();
            });
        }
        if (isExtensionActive && isAutoContinuing) {
            console.warn(LOG_PREFIX, 'AUTOCONTINUING');

            /*
            // uncomment to see exactly what was sent
            eventSource.once(event_types.GENERATE_AFTER_DATA, async (generate_data) => {
                console.warn(generate_data.prompt);
            });
            */

            let chat = getContext().chat;
            let lastMes = chat[chat.length - 1];

            console.warn(LOG_PREFIX, 'PRIMING CONTINUE WITH PREFIX');
            lastMes.mes = extension_settings.customReasoning.postReasoningPrefix;
            chat[chat.length - 1] = lastMes;
            await saveChat();
            await delay(200);
        }
    });

    //MARK: onMessageEnd
    eventSource.on(event_types.GENERATION_ENDED, async () => {
        if (!isExtensionActive) return;
        if (isAppLoading) return;

        console.warn(LOG_PREFIX, 'Generation ended');
        await delay(200);
        console.warn(`${LOG_PREFIX} MidGeneration? ${isMidGenerationCycle}, isAutoContinuing? ${isAutoContinuing}`);
        if (isReasoningProfileSwappedOn && isExtensionActive && !isProfileSwapping) {
            console.warn(LOG_PREFIX, 'G_ENDED; reverting');
            await swapToOriginalProfile();
        }
        if (!extension_settings.customReasoning.autoContinueAfterReasoning && isMidGenerationCycle) {
            isMidGenerationCycle = false;
        }
        if (isAutoContinuing && isMidGenerationCycle) {
            console.warn(LOG_PREFIX, 'clearing auto-continue and midcycle tags since we should be done.');
            isAutoContinuing = false;
            isMidGenerationCycle = false;
        }
        if (extension_settings.customReasoning.autoContinueAfterReasoning && isMidGenerationCycle && !isAutoContinuing) {
            console.warn(LOG_PREFIX, 'triggering auto-continue since we are still midcycle and havent done the continued response part yet');
            isAutoContinuing = true;
            $('#option_continue').trigger('click'); //old school smoothbrained method still used in script.js!
        }
        console.warn(`${LOG_PREFIX} AFTER GEND: MidGeneration? ${isMidGenerationCycle}, isAutoContinuing? ${isAutoContinuing}`);

    });

    eventSource.on(event_types.CONNECTION_PROFILE_LOADED, () => {
        if (!isExtensionActive) return;
        if (isReasoningProfileSwappedOn || isMidGenerationCycle || isAutoContinuing) { return; } //so we don't trigger on our own change
        console.warn(`${LOG_PREFIX} Main connection profile changed to ${activeConnectionProfileName}`);
        activeConnectionProfileName = $connectionProfilesSelect.find('option:selected').text();
    });
})();
