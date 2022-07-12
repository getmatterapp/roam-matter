import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { fetchQRSessionToken, pollQRLoginExchange } from '../auth';
import { ExtensionAPI, ExtensionSettings } from '../extension';

function useAuth(settings: ExtensionSettings) {
  const [loaded, setLoaded] = useState(false);
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);

  useEffect(() => {
    const accessToken = settings.get('accessToken');
    const refreshToken = settings.get('refreshToken');
    setAccessToken(accessToken);
    setRefreshToken(refreshToken);

    if (accessToken && window.roamMatter) {
      window.roamMatter.intervalSync();
    }

    setLoaded(true);
  }, []);

  const handleExchange = async (response: any) => {
    if (response.access_token && response.refresh_token) {
      setAccessToken(response.access_token);
      setRefreshToken(response.refresh_token);
      await settings.set('accessToken', response.access_token);
      await settings.set('refreshToken', response.refresh_token);

      if (response.access_token && window.roamMatter) {
        window.roamMatter.startIntervalSync();
        window.roamMatter.sync();
      }
    }
  }

  return {
    loaded,
    accessToken,
    refreshToken,
    handleExchange,
  }
}

export default function Auth({ extensionAPI }: { extensionAPI: ExtensionAPI }) {
  const { settings } = extensionAPI;
  const [sessionToken, setSessionToken] = useState(null);
  const { accessToken, refreshToken, loaded, handleExchange } = useAuth(settings);
  const isAuthed = accessToken && refreshToken && loaded;

  const setupQR = async () => {
    let _sessionToken = await fetchQRSessionToken();
    setSessionToken(_sessionToken);
    const response = await pollQRLoginExchange(_sessionToken);
    handleExchange(response);
  }

  useEffect(() => {
    if (!isAuthed && loaded) {
      setupQR();
    }
  }, [isAuthed, loaded]);

  if (isAuthed) {
    return (
      <div>
        <p>✅</p>
      </div>
    );
  }

  return (
    <div>
      {sessionToken &&
        <QRCodeSVG value={sessionToken} size={75} />
      }
    </div>
  );
}