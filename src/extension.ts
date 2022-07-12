import getBasicTreeByParentUid from "roamjs-components/queries/getBasicTreeByParentUid";
import getPageUidByPageTitle from "roamjs-components/queries/getPageUidByPageTitle";
import createBlock from "roamjs-components/writes/createBlock";
import createPage from "roamjs-components/writes/createPage";
import { maxNumWrites, syncIntervals } from "./constants";
import { Annotation, authedRequest, ENDPOINTS, FeedEntry, FeedResponse, Tag } from "./api";

export interface ExtensionAPI {
  settings: ExtensionSettings;
}

export interface ExtensionSettings {
  get: (key: string) => any;
  getAll: () => any[];
  set: (key: string, value: any) => Promise<any>;
  panel: {
    create: (config: any) => any;
  }
}

export default class Extension {
  private settings: ExtensionSettings;
  private runningInterval: number;

  constructor(settings: ExtensionSettings) {
    this.settings = settings;

    window.roamAlphaAPI.ui.commandPalette.addCommand({
      label: "Sync with Matter",
      callback: () => {
        if (!settings.get('isSyncing')) {
          this.sync();
        }
      },
    });

    if (settings.get('accessToken')) {
      this.startIntervalSync();
    }
  }

  unload() {
    if (this.runningInterval) {
      clearInterval(this.runningInterval);
    }
    window.roamAlphaAPI.ui.commandPalette.removeCommand({
      label: "Sync with Matter",
    });
  }

  public async startIntervalSync() {
    await this.settings.set('isSyncing', false);
    if (this.runningInterval) {
      clearInterval(this.runningInterval);
    }
    this.runningInterval = setInterval(this.intervalSync.bind(this), 60 * 1000) as any;
  }

  public intervalSync() {
    const now = new Date();
    const lastSync = this.getLastSync();
    const syncIntervalKey = this.settings.get('syncInterval');
    const syncInterval = syncIntervals[syncIntervalKey]
    const isSyncing = this.settings.get('isSyncing');

    let should = false;
    if (lastSync) {
      const diffMs = (now as any) - (lastSync as any)
      const diffS = diffMs / 1000;
      const diffM = diffS / 60;
      if (syncInterval > 0 && diffM >= syncInterval) {
        should = true;
      }
    } else {
      should = true;
    }

    if (should && !isSyncing) {
      this.sync();
    }
  }

  public async sync() {
    await this.settings.set('isSyncing', true);
    try {
      const complete = await this.pageAnnotations();
      await this.setLastSync(new Date());
      if (complete) {
        await this.settings.set('isSyncing', false);
      } else {
        setTimeout(this.sync.bind(this), 60 * 1000)
      }
    } catch (error) {
      console.error(error);
    }
  }

  private async pageAnnotations() {
    let url = ENDPOINTS.HIGHLIGHTS_FEED;
    let feedEntries: FeedEntry[] = [];

    // Load all feed items new to old.
    while (url !== null) {
      const response: FeedResponse = await this.authedRequest(url);
      feedEntries = feedEntries.concat(response.feed);
      url = response.next;
    }

    // Reverse the feed items so that chronological ordering is preserved.
    feedEntries = feedEntries.reverse();

    let writeCount = 0;
    for (const feedEntry of feedEntries) {
      const written = await this.handleFeedEntry(feedEntry);

      if (written) {
        writeCount += 1;
      }

      if (writeCount >= maxNumWrites) {
        return false;
      }
    }

    return true;
  }

  private async authedRequest(url: string) {
    const accessToken = this.settings.get('accessToken');
    try {
      return (await authedRequest(accessToken, url));
    } catch (e) {
      await this.refreshTokenExchange();
      return (await authedRequest(accessToken, url));
    }
  }

  private async refreshTokenExchange() {
    const refreshToken = this.settings.get('refreshToken');

    const headers = new Headers();
    headers.set('Content-Type', 'application/json');
    const response = await fetch(ENDPOINTS.REFRESH_TOKEN_EXCHANGE, {
      method: 'POST',
      headers,
      body: JSON.stringify({ refresh_token: refreshToken })
    });
    const payload = await response.json();
    await this.settings.set('accessToken', payload.access_token);
    await this.settings.set('refreshToken', payload.refresh_token);
  }

  private async handleFeedEntry(feedEntry: FeedEntry): Promise<boolean> {
    const pageTitle = `${feedEntry.content.title} #[[Matter]]`;
    let pageUid = getPageUidByPageTitle(pageTitle);
    if (pageUid) {
      let lastSync = this.getLastSync();
      let annotations = feedEntry.content.my_annotations;

      if (lastSync) {
        annotations = annotations.filter(a => new Date(a.created_date) > lastSync);
      }

      if (annotations.length) {
        await this.appendAnnotationsToPage(pageUid, annotations);
        return true
      }
    } else {
      pageUid = await createPage({
        title: pageTitle
      });
      await this.renderPage(feedEntry, pageUid);
      return true;
    }

    return false;
  }

  private async renderPage(feedEntry: FeedEntry, pageUid: string) {
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
        text: this.renderTags(feedEntry.content.tags)
      }
    });

    // Published Date
    if (feedEntry.content.publication_date) {
      const publicationDate = new Date(feedEntry.content.publication_date);
      const publicationDateStr = publicationDate.toISOString().slice(0, 10);
      await createBlock({
        parentUid: pageUid,
        order: 3,
        node: {
          text: `Published Date:: ${publicationDateStr}`
        }
      });
    }

    this.appendAnnotationsToPage(pageUid, feedEntry.content.my_annotations);
  }

  private async appendAnnotationsToPage(pageUid: string, annotations: Annotation[]) {
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
      const highlightsParent = getBasicTreeByParentUid(highlightsTreeUid);
      const textBlockUid = await createBlock({
        parentUid: highlightsTreeUid,
        order: highlightsParent.length,
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

  private renderTags(tags: Tag[]): string {
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

  private getLastSync(): Date | null {
    const dateStr = this.settings.get('lastSync');
    if (dateStr) {
      return new Date(dateStr);
    }
    return null;
  }

  private async setLastSync(value: Date) {
    await this.settings.set('lastSync', value.toISOString());
  }
}