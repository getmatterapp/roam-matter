import Auth from "./components/Auth";
import SyncNowButton from "./components/SyncNowButton";
import { syncIntervals } from "./constants";
import Extension, { ExtensionAPI } from "./extension";

interface OnloadArgs {
  extensionAPI: ExtensionAPI
}

async function onload({ extensionAPI }: OnloadArgs) {
  if (!extensionAPI.settings.get('syncInterval')) {
    await extensionAPI.settings.set('syncInterval', 'Every hour');
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
        id: "isSyncing",
        name: "Sync Now",
        description: 'Manually start a sync with Matter',
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