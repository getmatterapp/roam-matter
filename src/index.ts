import Auth from "./components/Auth";
import SyncNowButton from "./components/SyncNowButton";
import { syncIntervals, syncLocationArticlePage, syncLocationArticlePageAndDailyNote, syncLocations } from "./constants";
import Extension, { ExtensionAPI } from "./extension";

interface OnloadArgs {
  extensionAPI: ExtensionAPI
}

async function onload({ extensionAPI }: OnloadArgs) {
  if (!extensionAPI.settings.get('syncInterval')) {
    await extensionAPI.settings.set('syncInterval', 'Manual');
  }

  // Migrate from old syncToDaily setting to new syncLocation setting
  let syncToDaily = extensionAPI.settings.get('syncToDaily')
  if (syncToDaily !== null) {
    if (syncToDaily) {
      await extensionAPI.settings.set('syncLocation', syncLocationArticlePageAndDailyNote);
    } else {
      await extensionAPI.settings.set('syncLocation', syncLocationArticlePage);
    }
    await extensionAPI.settings.set('syncToDaily', null);
  }

  // Set a default sync location if none is set
  if (!extensionAPI.settings.get('syncLocation')) {
    await extensionAPI.settings.set('syncLocation', syncLocationArticlePageAndDailyNote);
  }

  window.roamMatter = new Extension(extensionAPI.settings);

  const wrappedAuth = () => Auth({ extensionAPI });
  const wrappedSyncNowButton = () => SyncNowButton({ extensionAPI });
  extensionAPI.settings.panel.create({
    tabTitle: 'Matter',
    settings: [
      {
        id: 'authentication',
        name: 'Authentication',
        description: 'Go to Settings > Connected Accounts > Roam and scan the QR code to log ',
        action: {
          type: 'reactComponent',
          component: wrappedAuth,
        }
      },
      {
        id: 'syncInterval',
        name: 'Sync Frequency',
        description: 'How often should Roam sync with Matter?',
        action: {
          type: "select",
          items: Object.keys(syncIntervals),
        }
      },
      {
        id: 'syncLocation',
        name: 'Sync Location',
        description: 'Where your Matter highlights will be synced to.',
        action: {
          type: "select",
          items: syncLocations,
        }
      },
      {
        id: "isSyncing",
        name: "Sync Now",
        description: 'Manually start a sync with Matter. This can take a while. Even if you don\'t see changes, the sync is running.',
        action: {
          type: 'reactComponent',
          component: wrappedSyncNowButton,
        }
      },
    ]
  });
}

function onunload() {
  window.roamMatter.unload();
}

export default {
  onload,
  onunload,
}