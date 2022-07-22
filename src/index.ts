import Auth from "./components/Auth";
import SyncNowButton from "./components/SyncNowButton";
import { syncIntervals } from "./constants";
import Extension, { ExtensionAPI } from "./extension";

interface OnloadArgs {
  extensionAPI: ExtensionAPI
}

async function onload({ extensionAPI }: OnloadArgs) {
  if (!extensionAPI.settings.get('syncInterval')) {
    await extensionAPI.settings.set('syncInterval', 'Manual');
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
        id: 'syncToDaily',
        name: 'Sync to Daily Notes',
        description: 'Track what you read over time. Enable to include block references to highlights in your daily notes.',
        action: {
          type: 'switch',
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