import toConfigPageName from "roamjs-components/util/toConfigPageName";
import runExtension from "roamjs-components/util/runExtension";
import { createConfigObserver } from "roamjs-components/components/ConfigPage";
import { CustomField, Field, SelectField } from "roamjs-components/components/ConfigPanels/types";
import CustomPanel from "roamjs-components/components/ConfigPanels/CustomPanel";
import SelectPanel from "roamjs-components/components/ConfigPanels/SelectPanel";
import getBasicTreeByParentUid from 'roamjs-components/queries/getBasicTreeByParentUid';
import getPageUidByPageTitle from 'roamjs-components/queries/getPageUidByPageTitle';
import Auth from "./components/Auth";
import { Annotation, authedRequest, ENDPOINTS, FeedEntry, FeedResponse, Tag } from "./api";
import getSettingValueFromTree from "roamjs-components/util/getSettingValueFromTree";
import setInputSetting from "roamjs-components/util/setInputSetting";
import getSubTree from "roamjs-components/util/getSubTree";
import { createBlock, createPage, deleteBlock } from "roamjs-components/writes";

const configPage = toConfigPageName('matter')
const extensionId = "roam-matter";
const authConfigKey = "authentication";
const syncIntervalKey = "sync interval";
const syncStatusMessage = "Sync in progress...";
const maxNumWrites = 20;

declare global {
  interface Window {
    roamMatterSyncInterval: number;
    roamMatterIsSyncing: boolean;
  }
}

interface Auth {
  access_token: string;
  refresh_token: string;
}

const syncIntervals: {[key: string]: number} = {
  "Manual": -1,
  "Every half hour": 30,
  "Every hour": 60,
  "Every 12 hours": 60 * 12,
  "Every 24 hours": 60 * 24,
}

export default runExtension({
  extensionId,
  run: async () => {
    await createConfigObserver({ title: configPage, config: {
      tabs: [
        {
          id: 'setup',
          fields: [
            {
              title: authConfigKey,
              description: "Sign in with Matter",
              Panel: CustomPanel,
              options: {
                component: Auth,
              },
            } as Field<CustomField>,
            {
              title: syncIntervalKey,
              description: 'How often Roam should sync with Matter',
              options: {
                items: Object.keys(syncIntervals),
              },
              Panel: SelectPanel,
              defaultValue: 'Every hour',
            } as Field<SelectField>,
          ]
        },
      ]
    }});

    window.roamAlphaAPI.ui.commandPalette.addCommand({
      label: "Sync with Matter",
      callback: sync,
    });

    window.roamMatterSyncInterval = setInterval(shouldSync, 60 * 1000) as any;
    await setSyncStatus(false);
  },
  unload: () => {
    if (window.roamMatterSyncInterval) {
      clearInterval(window.roamMatterSyncInterval);
    }
  },
});

export function shouldSync() {
  const now = new Date();
  const lastSync = getLastSync();

  if (lastSync) {
    const diffMs = (now as any) - (lastSync as any)
    const diffS = diffMs / 1000;
    const diffM = diffS / 60;
    if (diffM >= getSyncInterval()) {
      sync();
    }
  } else {
    sync();
  }
}

function getSetupTree() {
  return getSubTree({
    parentUid: getPageUidByPageTitle(configPage),
    key: 'setup',
  })
}

function getAuth(): Auth | null {
  const setupTree = getSetupTree();
  const dataStr = getSettingValueFromTree({ parentUid: setupTree.uid, key: authConfigKey });
  if (dataStr) {
    return JSON.parse(dataStr);
  }
  return null;
}

function getSyncInterval(): number | null {
  const setupTree = getSetupTree();
  const key = getSettingValueFromTree({
    parentUid: setupTree.uid,
    key: syncIntervalKey,
    defaultValue: 'Every hour',
  });
  return syncIntervals[key] || null;
}

function getLastSync(): Date | null {
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

async function setLastSync(date: Date) {
  const setupTree = getSetupTree();
  await setInputSetting({
    blockUid: setupTree.uid,
    key: 'last sync',
    value: date.toISOString(),
  });
}

async function setSyncStatus(value: boolean) {
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

function getSyncStatus() {
  const configPageUid = getPageUidByPageTitle(configPage)
  const blocks = getBasicTreeByParentUid(configPageUid);
  const syncStatusBlock = blocks.find(b => b.text === syncStatusMessage);
  return !!syncStatusBlock;
}

export async function sync() {
  if (window.roamMatterIsSyncing) {
    return;
  }

  await setSyncStatus(true);
  try {
    const complete = await pageAnnotations();
    await setLastSync(new Date());
    if (complete) {
      await setSyncStatus(false);
    } else {
      setTimeout(sync, 60 * 1000)
    }
  } catch (error) {
    console.error(error);
  }
}

async function pageAnnotations(): Promise<boolean> {
  let url = ENDPOINTS.HIGHLIGHTS_FEED;
  let feedEntries: FeedEntry[] = [];

  // Load all feed items new to old.
  while (url !== null) {
    const response: FeedResponse = await _authedRequest(url);
    feedEntries = feedEntries.concat(response.feed);
    url = response.next;
  }

  // Reverse the feed items so that chronological ordering is preserved.
  feedEntries = feedEntries.reverse();

  let writeCount = 0;
  for (const feedEntry of feedEntries) {
    const written = await handleFeedEntry(feedEntry);

    if (written) {
      writeCount += 1;
    }

    if (writeCount >= maxNumWrites) {
      return false;
    }
  }

  return true;
}

async function handleFeedEntry(feedEntry: FeedEntry): Promise<boolean> {
  const pageTitle = `${feedEntry.content.title} (Matter)`;

  let pageUid = getPageUidByPageTitle(pageTitle);
  if (pageUid) {
    let lastSync = getLastSync();
    let annotations = feedEntry.content.my_annotations;

    if (lastSync) {
      annotations = annotations.filter(a => new Date(a.created_date) > lastSync);
    }

    if (annotations.length) {
      await appendAnnotationsToPage(pageUid, annotations);
      return true
    }
  } else {
    pageUid = await createPage({
      title: pageTitle
    });
    await renderPage(feedEntry, pageUid);
    return true;
  }

  return false;
}

async function renderPage(feedEntry: FeedEntry, pageUid: string) {
  // Title / URL
  await createBlock({
    parentUid: pageUid,
    order: 0,
    node: {
      text: `Source:: [${feedEntry.content.title}](${feedEntry.content.url})`
    }
  });

  // Author
  const authorName = feedEntry.content.author ? feedEntry.content.author.any_name : "";
  await createBlock({
    parentUid: pageUid,
    order: 1,
    node: {
      text: `Author:: [[${authorName}]]`
    }
  });

  // Tags
  await createBlock({
    parentUid: pageUid,
    order: 2,
    node: {
      text: renderTags(feedEntry.content.tags)
    }
  });

  // Published Date
  const publicationDate = new Date(feedEntry.content.publication_date);
  const publicationDateStr = publicationDate.toISOString().slice(0, 10);
  await createBlock({
    parentUid: pageUid,
    order: 3,
    node: {
      text: `Published Date:: ${publicationDateStr}`
    }
  });

  appendAnnotationsToPage(pageUid, feedEntry.content.my_annotations);
}

async function appendAnnotationsToPage(pageUid: string, annotations: Annotation[]) {
  annotations = annotations.sort((a, b) => a.word_start - b.word_start);
  const parent = getBasicTreeByParentUid(pageUid);

  const todayPageName = window.roamAlphaAPI.util.dateToPageTitle(new Date());
  const highlightsTreeText = `Highlights synced on [[${todayPageName}]]`;
  const highlightsTree = parent.find(n => n.text === highlightsTreeText);

  let highlightsTreeUid: string;
  if (highlightsTree) {
    highlightsTreeUid = highlightsTree.uid;
  } else {
    highlightsTreeUid = await createBlock({
      parentUid: pageUid,
      order: parent.length,
      node: {
        text: highlightsTreeText,
        heading: 2
      }
    });
  }

  for (let annotation of annotations) {
    const parent = getBasicTreeByParentUid(pageUid);
    const textBlockUid = await createBlock({
      parentUid: highlightsTreeUid,
      order: parent.length,
      node: {
        text: annotation.text,
      }
    });

    if (annotation.note) {
      await createBlock({
        parentUid: textBlockUid,
        order: 0,
        node: {
          text: `Note:: ${annotation.note}`,
        }
      });
    }
  }
}

function renderTags(tags: Tag[]): string {
  const tagStrs = tags.map(tag => {
    if (tag.name.includes(' ')) {
      return `#[[${tag.name}]]`;
    }
    return `#${tag.name}`;
  })

  if (tagStrs.length) {
    return `Tags:: ${tagStrs.join(' ')}`
  }

  return "Tags::";
}

async function _authedRequest(url: string) {
  const auth = getAuth();
  try {
    return (await authedRequest(auth.access_token, url));
  } catch (e) {
    await _refreshTokenExchange();
    return (await authedRequest(auth.access_token, url));
  }
}

async function _refreshTokenExchange() {
  const auth = getAuth();
  const headers = new Headers();
  headers.set('Content-Type', 'application/json');
  const response = await fetch(ENDPOINTS.REFRESH_TOKEN_EXCHANGE, {
    method: 'POST',
    headers,
    body: JSON.stringify({ refresh_token: auth.refresh_token })
  });
  const payload = await response.json();

  const setupTree = getSetupTree();
  setInputSetting({
    blockUid: setupTree.uid,
    key: authConfigKey,
    value: JSON.stringify(payload)
  });
}