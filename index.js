const {
    eventSource,
    event_types,
} = SillyTavern.getContext();

import { saveSettingsDebounced, saveChat, online_status } from '../../../../script.js';
import { delay } from '../../../utils.js';
import { extension_settings, getContext } from '../../../extensions.js';
import { SlashCommandParser } from '../../../slash-commands/SlashCommandParser.js';
import { SlashCommand } from '../../../slash-commands/SlashCommand.js';
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

let settings = null;

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
    const settings = extension_settings?.customReasoning;
    if (!settings) return null;
    return settings;
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

async function waitForEvent(eventName, timeout = 5000) {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            eventSource.removeListener(eventName, onEvent);
            reject(new Error(`Timed out waiting for event "${eventName}"`));
        }, timeout);

        function onEvent(...args) {
            clearTimeout(timer);
            eventSource.removeListener(eventName, onEvent);
            resolve(...args);
            console.warn(`${LOG_PREFIX} Received and Resolved event "${eventName}"`);
        }

        eventSource.once(eventName, onEvent);
    });
}

//MARK:SwapToReasoning
async function swapToReasoningProfile() {

    if (extension_settings.customReasoning.reasoningProfile == 'None') {
        console.error(LOG_PREFIX, 'No reasoning profile selected');
        isReasoningProfileSwappedOn = false;
        return;
    }


    if (activeConnectionProfileName === extension_settings.customReasoning.reasoningProfileName) {
        console.warn(`${LOG_PREFIX} Reasoning profile is the same as the Response profile. Aborting swap process, but setting isReasoningProfileSwappedOn to true to allow proper swapping back.`);
        isReasoningProfileSwappedOn = true;
        return
    }

    activeConnectionProfileName = $connectionProfilesSelect.find('option:selected').text();
    console.warn(`${LOG_PREFIX} Saving active main profile as "${activeConnectionProfileName}" for later reversion.`);
    isProfileSwapping = true;

    console.warn(`${LOG_PREFIX} Swapping to reasoning profile ${extension_settings.customReasoning.reasoningProfileName}`);

    try {

        const waitForProfileLoad = waitForEvent(event_types.CONNECTION_PROFILE_LOADED, 5000);

        console.warn(`${LOG_PREFIX} sending slashcommand callback`);
        await SlashCommandParser.commands['profile'].callback(
            {
                await: 'true',
                _scope: null,
                _abortController: null,
            },
            extension_settings.customReasoning.reasoningProfileName,
        );
        console.warn(`${LOG_PREFIX} sent slashcommand callback`);

        await waitUntilCondition(() => online_status === 'no_connection', 5000, 100);
        console.warn(`${LOG_PREFIX} Saw online_status change to no_connection; Waiting for profile to load...`);
        await waitForProfileLoad;
        console.warn(`${LOG_PREFIX} Profile loaded; Waiting for status to change to online...`);
        await waitUntilCondition(() => online_status !== 'no_connection', 5000, 100);
        console.warn(`${LOG_PREFIX} Saw online_status change to online`);

        isReasoningProfileSwappedOn = true;
        isProfileSwapping = false;
        console.warn(`${LOG_PREFIX} Successfully swapped to reasoning profile`);
        console.warn(`${LOG_PREFIX} Confirming Response Profile is ${activeConnectionProfileName}`);

    } catch (error) {
        console.error(`${LOG_PREFIX} Failed to swap to reasoning profile: ${error}`);
    }
}


//MARK:SwapBack
async function swapToOriginalProfile() {

    if (activeConnectionProfileName === null || activeConnectionProfileName === undefined) {
        console.warn(`${LOG_PREFIX} No Response profile found. Aborting swap process.`);
        return
    }

    if (activeConnectionProfileName === extension_settings.customReasoning.reasoningProfileName) {
        console.warn(`${LOG_PREFIX} Response profile is the same as the Reasoning profile. Aborting swap process, but setting isReasoningProfileSwappedOn to false to complete the swap process logic.`);
        isReasoningProfileSwappedOn = false;
        return
    }

    console.warn(`${LOG_PREFIX} Swapping back to original profile: "${activeConnectionProfileName}"`);
    isProfileSwapping = true;
    try {

        const waitForProfileLoad = waitForEvent(event_types.CONNECTION_PROFILE_LOADED, 5000);

        console.warn(`${LOG_PREFIX} sending slashcommand callback`);
        await SlashCommandParser.commands['profile'].callback(
            {
                await: 'true',
                _scope: null,
                _abortController: null,
            },
            activeConnectionProfileName,
        );
        console.warn(`${LOG_PREFIX} sent slashcommand callback`);

        await waitUntilCondition(() => online_status === 'no_connection', 5000, 100);
        console.warn(`${LOG_PREFIX} Saw online_status change to no_connection; Waiting for profile to load...`);
        await waitForProfileLoad;
        console.warn(`${LOG_PREFIX} Profile loaded; Waiting for status to change to online...`);
        await waitUntilCondition(() => online_status !== 'no_connection', 5000, 100);
        console.warn(`${LOG_PREFIX} Saw online_status change to online`);

        isProfileSwapping = false;
        isReasoningProfileSwappedOn = false;
        console.warn(`${LOG_PREFIX} Successfully swapped back to original profile`);

    } catch (error) {
        console.error(`${LOG_PREFIX} Failed to swap to reasoning profile: ${error}`);
    }
}

//MARK: regSlashCommands
function registerExtensionSlashCommands() {
    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'TCRP-swapToReasoning',
        callback: swapToReasoningProfileViaSlash,
        returns: 'nothing',
        helpString: `Force the TCRP extension to swap to its Reasoning profile. Will execute even if the extension's power button is set to "off".`,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'TCRP-swapToResponse',
        callback: swapToResponseProfileViaSlash,
        returns: 'nothing',
        helpString: `Force the TCRP  extension to swap to the last known Response profile. Will execute even if the extension's power button is set to "off".`,
    }));

    SlashCommandParser.addCommandObject(SlashCommand.fromProps({
        name: 'TCRP-toggle',
        callback: toggleExtensionViaSlash,
        returns: 'nothing',
        helpString: `Toggles the TCRP Extension on and off.`,
    }));
}

async function swapToReasoningProfileViaSlash() {
    console.warn(`${LOG_PREFIX} Received slashcommand /TCRP-swapToReasoning`);
    await swapToReasoningProfile();
    return 'ok'
}

async function swapToResponseProfileViaSlash() {
    console.warn(`${LOG_PREFIX} Received slashcommand /TCRP-swapToResponse`);
    await swapToOriginalProfile();
    return 'ok'
}

async function toggleExtensionViaSlash() {
    console.warn(`${LOG_PREFIX} Received slashcommand /TCRP-toggle`);
    $('#customReasoningPowerButton').trigger('click');
    return 'ok'
}

function checkIfLastMesIsByUser() {
    let lastMesIsUser
    let { chat } = SillyTavern.getContext();
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

//MARK:OnMessageStart
async function messageStartListener() {
    if (!isExtensionActive) return;
    if (isAppLoading) return;

    console.warn(`Generation started; triggerType: ${triggerType}, isReasoningProfileSwappedOn? ${isReasoningProfileSwappedOn}, isMidGenerationCycle? ${isMidGenerationCycle}, isAutoContinuing? ${isAutoContinuing}`);

    let triggerOnlyWhenUserLast = extension_settings.customReasoning.onlyTriggerWhenUserLast;

    let isLastMesByUser = null

    isLastMesByUser = checkIfLastMesIsByUser();

    console.warn(`${LOG_PREFIX} triggerOnlyWhenUserLast: ${triggerOnlyWhenUserLast}, isLastMesByUser: ${isLastMesByUser}`);
    if (!isAutoContinuing && triggerOnlyWhenUserLast && isLastMesByUser === false) {
        console.warn(`${LOG_PREFIX} Skipping generation because last message is not by user`);
        return
    }

    isMidGenerationCycle = true;

    if (!isReasoningProfileSwappedOn && isExtensionActive && !isAutoContinuing) {
        console.warn(LOG_PREFIX, 'Swapping to reasoning Profile');
        await swapToReasoningProfile();
        console.warn(LOG_PREFIX, 'Swapped to reasoning Profile; back in the main message Start listener');
    }
    if (isExtensionActive && isAutoContinuing) {
        console.warn(LOG_PREFIX, 'AUTOCONTINUING');

        let chat = getContext().chat;
        let lastMes = chat[chat.length - 1];

        console.warn(LOG_PREFIX, 'PRIMING CONTINUE WITH PREFIX');
        lastMes.mes = extension_settings.customReasoning.postReasoningPrefix;
        chat[chat.length - 1] = lastMes;
        await saveChat();
        await delay(200);
    }
}


function setupStartListener() {
    console.warn(`${LOG_PREFIX} Setting up start listener for type ${triggerType}`);

    eventSource.removeListener(event_types.GENERATION_STARTED, messageStartListener);
    eventSource.removeListener(event_types.USER_MESSAGE_RENDERED, messageStartListener);

    eventSource.on(event_types[triggerType], messageStartListener);
}

function toggleExtensionState(state) {
    const $activeToggle = $('#customReasoningPowerButton');
    //console.warn(`Toggling extension active state to ${state}`);
    $activeToggle.toggleClass('toggleEnabled', state);
    extension_settings.customReasoning.isExtensionActive = state;
    saveSettingsDebounced();
    console.warn(`${LOG_PREFIX} Extension state toggled to ${state}`);
}

//MARK: onDOMReady
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
        setupStartListener();
        registerExtensionSlashCommands();
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
        setupStartListener();
        saveSettingsDebounced();
    })

    $postReasoningPrefix.off('change').on('change', (e) => {
        extension_settings.customReasoning.postReasoningPrefix = $postReasoningPrefix.val();
        saveSettingsDebounced();
    });

    //MARK: onMessageEnd
    eventSource.on(event_types.GENERATION_ENDED, async () => {
        if (!isExtensionActive) return;
        if (isAppLoading) return;

        console.warn(LOG_PREFIX, 'Generation ended');
        await delay(200);
        console.warn(`${LOG_PREFIX} MidGeneration? ${isMidGenerationCycle}, isReasoningProfileSwappedOn? ${isReasoningProfileSwappedOn}, isAutoContinuing? ${isAutoContinuing}`);
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
        if (isProfileSwapping || isMidGenerationCycle || isAutoContinuing) { return; } //so we don't trigger on our own change
        console.warn(`${LOG_PREFIX} Main connection profile changed to ${activeConnectionProfileName}`);
        activeConnectionProfileName = $connectionProfilesSelect.find('option:selected').text();
    });
})();
