import getBasicTreeByParentUid from "roamjs-components/queries/getBasicTreeByParentUid";
import getPageUidByPageTitle from "roamjs-components/queries/getPageUidByPageTitle";
import getPageTitleByPageUid from "roamjs-components/queries/getPageTitleByPageUid";
import getBlockUidByTextOnPage from "roamjs-components/queries/getBlockUidByTextOnPage";
import createBlock from "roamjs-components/writes/createBlock";
import createPage from "roamjs-components/writes/createPage";
import { intervalSyncMinutes, maxNumWrites, syncCooldownMinutes, syncIntervals, syncJitterRange, syncLocationArticlePage, syncLocationArticlePageAndDailyNote, syncLocationDailyNote, syncStaleMinutes } from "./constants";
import { Annotation, authedRequest, ENDPOINTS, FeedEntry, FeedResponse, Tag } from "./api";
import { diffInMinutes, randomInt } from "./utils";

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
  private syncJitter: number = randomInt(syncJitterRange);  // +/- 3 minutes

  constructor(settings: ExtensionSettings) {
    this.settings = settings;

    window.roamAlphaAPI.ui.commandPalette.addCommand({
      label: "Sync with Matter",
      callback: () => {
        if (!settings.get('isSyncing') && settings.get('accessToken')) {
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
    if (this.runningInterval) {
      clearInterval(this.runningInterval);
    }
    this.runningInterval = setInterval(this.intervalSync.bind(this), 60 * intervalSyncMinutes * 1000) as any;
  }

  public intervalSync() {
    // If a sync has been abandoned, restart the process
    if (this.isSyncStale() && this.settings.get('isSyncing')) {
      this.sync();
      return;
    }

    const now = new Date();
    const lastSync = this.getLastSync();
    const syncIntervalKey = this.settings.get('syncInterval');

    let syncInterval = syncIntervals[syncIntervalKey];
    if (syncInterval < 0) {
      return;
    }
    syncInterval += this.syncJitter;

    let should = false;
    if (lastSync) {
      if (syncInterval > 0 && diffInMinutes(now, lastSync) >= syncInterval) {
        should = true;
      }
    } else {
      should = true;
    }

    // If a sync hasn't happened in some time, start a new one
    if (should && !this.settings.get('isSyncing')) {
      this.sync();
    }
  }

  public async sync() {
    this.syncHeartbeat();
    await this.setIsSyncing(true);
    try {
      const complete = await this.pageAnnotations();
      if (complete) {
        await this.setLastSync(new Date());
        await this.setIsSyncing(false);
      } else {
        setTimeout(this.sync.bind(this), 60 * syncCooldownMinutes * 1000)
      }
    } catch (error) {
      console.error(error);
    }
    this.syncHeartbeat();
  }

  private async pageAnnotations() {
    let url = ENDPOINTS.HIGHLIGHTS_FEED;
    let feedEntries: FeedEntry[] = [];

    // Load all feed items new to old.
    while (url !== null) {
      this.syncHeartbeat();
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
      try {
        await this.refreshTokenExchange();
        return (await authedRequest(accessToken, url));
      } catch (error) {
        await this.settings.set('accessToken', null);
        await this.settings.set('refreshToken', null);
        throw error
      }
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
    if (this.settings.get('syncLocation') === syncLocationDailyNote) {
      let lastSync = this.getLastSync();
      let annotations = feedEntry.content.my_annotations;

      if (lastSync) {
        annotations = annotations.filter(a => new Date(a.created_date) > lastSync);
      }

      let newAnnotations = []
      for (const annotation of annotations) {
        const alreadySynced = await this.annotationAppearsInJournalPage(annotation);
        if (!alreadySynced) {
          newAnnotations.push(annotation);
        }
      }

      if (newAnnotations.length) {
        await this.appendAnnotationsToJournal(feedEntry, newAnnotations);
        return true;
      }
    } else {
      const pageTitle = `${feedEntry.content.title}`;
      let pageUid = getPageUidByPageTitle(pageTitle);
      if (pageUid) {
        let lastSync = this.getLastSync();
        let annotations = feedEntry.content.my_annotations;

        if (lastSync) {
          annotations = annotations.filter(a => new Date(a.created_date) > lastSync);
        }

        annotations = annotations.filter(a => !this.annotationAppearsInPage(a, pageUid))

        if (annotations.length) {
          await this.appendAnnotationsToPage(pageUid, feedEntry, annotations);
          return true;
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
  }

  private getContentCreator(feedEntry: FeedEntry): string | null {
    let creator = null;
    if (feedEntry.content.author) {
      if (feedEntry.content.author.any_name) {
        creator = `[[${feedEntry.content.author.any_name}]]`
      } else if (feedEntry.content.author.domain) {
        creator = `[[${feedEntry.content.author.domain}]]`
      }
    } else if (feedEntry.content.newsletter_profile) {
      creator = `[[${feedEntry.content.newsletter_profile.any_name}]]`
    } else if (feedEntry.content.publisher) {
      if (feedEntry.content.publisher.any_name) {
        creator = `[[${feedEntry.content.publisher.any_name}]]`
      } else {
        creator = `[[${feedEntry.content.publisher.domain}]]`
      }
    }
    return creator
  }

  private async renderPage(feedEntry: FeedEntry, pageUid: string) {
    let creator = this.getContentCreator(feedEntry);

    let metablockText = '';
    if (creator) {
      metablockText = `Author ${creator}`;
    } else {
      metablockText = `Metadata`;
    }

    metablockText = `${metablockText}${this.renderTags(feedEntry.content.tags)}`
    const metablockUid = await createBlock({
      parentUid: pageUid,
      order: 0,
      node: {
        text: metablockText,
        heading: 3
      }
    });

    await createBlock({
      parentUid: metablockUid,
      order: 0,
      node: {
        text: `Source:: [${feedEntry.content.title}](${feedEntry.content.url})`
      }
    });

    if (feedEntry.content.my_note && feedEntry.content.my_note.note) {
      await createBlock({
        parentUid: metablockUid,
        order: 1,
        node: {
          text: `Note:: ${feedEntry.content.my_note.note}`
        }
      });
    }

    this.appendAnnotationsToPage(pageUid, feedEntry, feedEntry.content.my_annotations);
  }

  private async appendAnnotationsToJournal(feedEntry: FeedEntry, annotations: Annotation[]) {
    if (!annotations.length) {
      return;
    }

    for (const annotation of annotations) {
      const createdDate = new Date(annotation.created_date)
      const journalPageUid = await this.getOrCreateJournalPage(createdDate);
      const articleBlockUid = await this.getOrCreateJournalArticleBlock(journalPageUid, feedEntry);
      const articleTree = getBasicTreeByParentUid(articleBlockUid);
      const highlightBlockUid = await createBlock({
        parentUid: articleBlockUid,
        order: articleTree.length,
        node: {
          text: annotation.text,
        }
      });

      if (annotation.note) {
        await createBlock({
          parentUid: highlightBlockUid,
          node: {
            text: `Note:: ${annotation.note}`,
          }
        });
      }

      await createBlock({
        parentUid: highlightBlockUid,
        node: {
          text: `Created at ${createdDate.toTimeString().slice(0, 5)}`
        }
      });
    }
  }

  private async appendAnnotationsToPage(pageUid: string, feedEntry: FeedEntry, annotations: Annotation[]) {
    if (!annotations.length) {
      return;
    }

    const page = getBasicTreeByParentUid(pageUid);
    const parent = page[0];

    annotations = annotations.sort((a, b) => a.word_start - b.word_start);

    const todayPageName = window.roamAlphaAPI.util.dateToPageTitle(new Date());
    const highlightsTreeText = `[[Highlights]] synced from [[Matter]] on [[${todayPageName}]]`;
    const highlightsTree = parent.children.find(n => n.text === highlightsTreeText);
    let highlightsTreeUid: string;
    if (highlightsTree) {
      highlightsTreeUid = highlightsTree.uid;
    } else {
      highlightsTreeUid = await createBlock({
        parentUid: parent.uid,
        order: parent.children.length,
        node: {
          text: highlightsTreeText,
        }
      });
    }

    for (let annotation of annotations) {
      const highlightsParent = getBasicTreeByParentUid(highlightsTreeUid);
      const annotationBlockUid = await createBlock({
        parentUid: highlightsTreeUid,
        order: highlightsParent.length,
        node: {
          text: annotation.text,
        }
      });

      // If not syncing to the daily note, sync any annotation notes here.
      if (annotation.note && this.settings.get('syncLocation') === syncLocationArticlePage) {
        await createBlock({
          parentUid: annotationBlockUid,
          node: {
            text: `Note:: ${annotation.note}`,
          }
        });
      }

      if (this.settings.get('syncLocation') === syncLocationArticlePageAndDailyNote) {
        await this.appendPageAnnotationToJournal(feedEntry, annotation, annotationBlockUid);
      }
    }
  }

  private annotationAppearsInPage(annotation: Annotation, pageUid: string): boolean {
    const title = getPageTitleByPageUid(pageUid).replaceAll('"', '\\"');
    const text = annotation.text.replaceAll('"', '\\"')
    try {
      if (getBlockUidByTextOnPage({ text, title })) {
        return true;
      } else {
        return false;
      }
    } catch (e) {
      return false;
    }
  }

  private async annotationAppearsInJournalPage(annotation: Annotation): Promise<boolean> {
    const createdDate = new Date(annotation.created_date)
    const journalPageName = window.roamAlphaAPI.util.dateToPageTitle(createdDate);
    let journalPageUid = getPageUidByPageTitle(journalPageName);
    if (!journalPageUid) {
      return false;
    }
    return this.annotationAppearsInPage(annotation, journalPageUid);
  }

  private async appendPageAnnotationToJournal(feedEntry: FeedEntry, annotation: Annotation, annotationBlockUid: string) {
    const createdDate = new Date(annotation.created_date)
    const journalPageUid = await this.getOrCreateJournalPage(createdDate);
    const articleBlockUid = await this.getOrCreateJournalArticleReferenceBlock(journalPageUid, feedEntry);
    const articleTree = getBasicTreeByParentUid(articleBlockUid);
    const refBlockUid = await createBlock({
      parentUid: articleBlockUid,
      order: articleTree.length,
      node: {
        text: `((${annotationBlockUid}))`,
      }
    });

    if (annotation.note) {
      await createBlock({
        parentUid: refBlockUid,
        node: {
          text: `Note:: ${annotation.note}`,
        }
      });
    }

    await createBlock({
      parentUid: refBlockUid,
      node: {
        text: `Created at ${createdDate.toTimeString().slice(0, 5)}`
      }
    });
  }

  private async getOrCreateJournalPage(date: Date) {
    const journalPageName = window.roamAlphaAPI.util.dateToPageTitle(date);
    let journalPageUid = getPageUidByPageTitle(journalPageName);
    if (!journalPageUid) {
      journalPageUid = await createPage({
        title: journalPageName
      });
    }
    return journalPageUid;
  }

  private async getOrCreateJournalArticleBlock(journalPageUid: string, feedEntry: FeedEntry) {
    const highlightsBlockUid = await this.getOrCreateJournalHighlightsBlock(journalPageUid);
    const highlightsBlock = getBasicTreeByParentUid(highlightsBlockUid);

    let articleTreeText = `${feedEntry.content.title}`;
    if (feedEntry.content.url) {
      articleTreeText = `[${articleTreeText}](${feedEntry.content.url})`;
    }

    articleTreeText += ` by ${this.getContentCreator(feedEntry)}`;
    articleTreeText += this.renderTags(feedEntry.content.tags);

    const articleTree = highlightsBlock.find(n => n.text === articleTreeText);
    let articleTreeUid: string;
    if (articleTree) {
      articleTreeUid = articleTree.uid;
    } else {
      articleTreeUid = await createBlock({
        parentUid: highlightsBlockUid,
        order: highlightsBlock.length,
        node: {
          text: articleTreeText,
        }
      });
    }

    return articleTreeUid;
  }

  private async getOrCreateJournalArticleReferenceBlock(journalPageUid: string, feedEntry: FeedEntry) {
    const highlightsBlockUid = await this.getOrCreateJournalHighlightsBlock(journalPageUid);
    const highlightsBlock = getBasicTreeByParentUid(highlightsBlockUid);

    const articleTreeText = `[[${feedEntry.content.title}]]`;
    const articleTree = highlightsBlock.find(n => n.text === articleTreeText);

    let articleTreeUid: string;
    if (articleTree) {
      articleTreeUid = articleTree.uid;
    } else {
      articleTreeUid = await createBlock({
        parentUid: highlightsBlockUid,
        order: highlightsBlock.length,
        node: {
          text: articleTreeText,
        }
      });
    }

    return articleTreeUid;
  }

  private async getOrCreateJournalHighlightsBlock(journalPageUid: string) {
    const journalPage = getBasicTreeByParentUid(journalPageUid);

    const highlightsTreeText = '[[Highlights]] created on [[Matter]]';
    const highlightsTree = journalPage.find(n => n.text === highlightsTreeText);

    let highlightsTreeUid: string;
    if (highlightsTree) {
      highlightsTreeUid = highlightsTree.uid;
    } else {
      highlightsTreeUid = await createBlock({
        parentUid: journalPageUid,
        order: journalPage.length,
        node: {
          text: highlightsTreeText,
        }
      });
    }

    return highlightsTreeUid;
  }

  private renderTags(tags: Tag[]): string {
    const tagStrs = tags.map(tag => {
      return `#[[${tag.name}]]`;
    })

    if (tagStrs.length) {
      return ` ${tagStrs.join(' ')}`
    }

    return '';
  }

  private async syncHeartbeat() {
    this.setDateSetting('syncHeartbeat', new Date());
  }

  private isSyncStale(): boolean {
    const lastHeartbeat = this.getDateSetting('syncHeartbeat');
    if (lastHeartbeat) {
      return diffInMinutes(new Date(), lastHeartbeat) > (syncStaleMinutes + this.syncJitter);
    }
    return true;
  }

  private getLastSync(): Date | null {
    return this.getDateSetting('lastSync')
  }

  private async setLastSync(value: Date) {
    this.setDateSetting('lastSync', value);
  }

  private async setIsSyncing(value: boolean) {
    await this.settings.set('isSyncing', value);
  }

  private async setDateSetting(key: string, value: Date) {
    await this.settings.set(key, value.toISOString());
  }

  private getDateSetting(key: string) {
    const dateStr = this.settings.get(key);
    if (dateStr) {
      return new Date(dateStr);
    }
    return null;
  }
}