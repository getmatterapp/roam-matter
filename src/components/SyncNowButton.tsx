import { useState, useEffect } from 'react';
import { ExtensionAPI } from "../extension";

const Button = (window as any).Blueprint.Core.Button;

export default function SyncNowButton({ extensionAPI }: { extensionAPI: ExtensionAPI }) {
  const { settings } = extensionAPI;
  const [isSyncing, setIsSyncing] = useState(settings.get('isSyncing'));
  const [accessToken, setAccessToken] = useState(settings.get('accessToken'));

  useEffect(() => {
    function watchSettings() {
      setIsSyncing(settings.get('isSyncing'));
      setAccessToken(settings.get('accessToken'));
    }

    const interval = setInterval(watchSettings, 100);
    return () => clearInterval(interval);
  }, [])

  return (
    <Button
      className='bp3-button bp3-intent-primary'
      disabled={isSyncing || !accessToken}
      onClick={() => window.roamMatter.sync()}
    >
      {isSyncing ? 'Syncing...' : 'Sync Now'}
    </Button>
  );
}