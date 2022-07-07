import { useState, useEffect } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import getSettingValueFromTree from 'roamjs-components/util/getSettingValueFromTree';

export default function Auth(props: any, b: any, c: any) {
  const [data, setData] = useState(null);

  useEffect(() => {
    const dataStr = getSettingValueFromTree({
      parentUid: props.parentUid,
      key: props.title,
    });

    if (dataStr) {
      setData(JSON.parse(dataStr));
    }
  }, [props.parentUid, props.title])

  if (data && data.access_token && data.refresh_token) {
    return <p>✅</p>
  }

  return (
    <div>
      <p>Scan the QR code from your Matter application</p>
      <QRCodeSVG value='test' />
    </div>
  );
}