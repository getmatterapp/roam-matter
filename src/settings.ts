import getBasicTreeByParentUid from 'roamjs-components/queries/getBasicTreeByParentUid';
import getPageUidByPageTitle from 'roamjs-components/queries/getPageUidByPageTitle';
import getSettingValueFromTree from "roamjs-components/util/getSettingValueFromTree";
import getSubTree from "roamjs-components/util/getSubTree";
import setInputSetting from 'roamjs-components/util/setInputSetting';
import createBlock from 'roamjs-components/writes/createBlock';
import deleteBlock from 'roamjs-components/writes/deleteBlock';
import { authConfigKey, configPage, syncIntervalKey, syncStatusMessage } from "./constants";
import { QRLoginExchangeResponse } from './api';

export const syncIntervals: {[key: string]: number} = {
  "Manual": -1,
  "Every half hour": 30,
  "Every hour": 60,
  "Every 12 hours": 60 * 12,
  "Every 24 hours": 60 * 24,
}

export function getSetupTree() {
  return getSubTree({
    parentUid: getPageUidByPageTitle(configPage),
    key: 'setup',
  })
}

export function getAuth(): QRLoginExchangeResponse | null {
  const setupTree = getSetupTree();
  const dataStr = getSettingValueFromTree({ parentUid: setupTree.uid, key: authConfigKey });
  if (dataStr) {
    return JSON.parse(dataStr);
  }
  return null;
}

export function getSyncInterval(): number | null {
  const setupTree = getSetupTree();
  const key = getSettingValueFromTree({
    parentUid: setupTree.uid,
    key: syncIntervalKey,
    defaultValue: 'Every hour',
  });
  return syncIntervals[key] || null;
}

export function getLastSync(): Date | null {
  const setupTree = getSetupTree();
  const dateStr = getSettingValueFromTree({
    parentUid: setupTree.uid,
    key: 'last sync',
    defaultValue: '',
  });

  if (dateStr) {
    return new Date(dateStr);
  }

  return null;
}

export async function setLastSync(date: Date) {
  const setupTree = getSetupTree();
  await setInputSetting({
    blockUid: setupTree.uid,
    key: 'last sync',
    value: date.toISOString(),
  });
}

export async function setSyncStatus(value: boolean) {
  window.roamMatterIsSyncing = value;
  const configPageUid = getPageUidByPageTitle(configPage)
  const blocks = getBasicTreeByParentUid(configPageUid);
  const syncStatusBlock = blocks.find(b => b.text === syncStatusMessage);

  if (syncStatusBlock) {
    await deleteBlock(syncStatusBlock.uid);
  }

  if (value) {
    await createBlock({
      parentUid: configPageUid,
      order: 0,
      node: {
        text: syncStatusMessage
      }
    })
  }
}