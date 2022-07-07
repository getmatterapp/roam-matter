import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import getSettingValueFromTree from 'roamjs-components/util/getSettingValueFromTree';
import { fetchQRSessionToken, pollQRLoginExchange } from '../auth';
import setInputSetting from 'roamjs-components/util/setInputSetting';
import { sync } from '..';

function useAuth(parentUid: string, key: string) {
  const [loaded, setLoaded] = useState(false);
  const [accessToken, setAccessToken] = useState(null);
  const [refreshToken, setRefreshToken] = useState(null);

  useEffect(() => {
    const dataStr = getSettingValueFromTree({
      parentUid,
      key,
    });

    if (dataStr) {
      const data = JSON.parse(dataStr);
      setAccessToken(data.access_token);
      setRefreshToken(data.refresh_token);
      sync();
    }

    setLoaded(true);
  }, []);

  const handleExchange = (response: any) => {
    if (response.access_token && response.refresh_token) {
      setAccessToken(response.access_token);
      setRefreshToken(response.refresh_token);
      setInputSetting({
        blockUid: parentUid,
        key,
        value: JSON.stringify(response)
      });
    }
  }

  return {
    loaded,
    accessToken,
    refreshToken,
    handleExchange,
  }
}

export default function Auth(props: any) {
  const [sessionToken, setSessionToken] = useState(null);
  const { accessToken, refreshToken, loaded, handleExchange } = useAuth(props.parentUid, props.title);
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
    return <p>✅</p>
  }

  return (
    <div>
      <p>Scan this QR code in the Matter app</p>
      <p>Go to Profile &gt; Settings &gt; Connected Accounts &gt; Roam</p>
      {sessionToken &&
        <QRCodeSVG value={sessionToken} />
      }
    </div>
  );
}