import { createConfigObserver } from "roamjs-components/components/ConfigPage";
import CustomPanel from "roamjs-components/components/ConfigPanels/CustomPanel";
import SelectPanel from "roamjs-components/components/ConfigPanels/SelectPanel";
import { CustomField, Field, SelectField } from "roamjs-components/components/ConfigPanels/types";
import runExtension from "roamjs-components/util/runExtension";
import Auth from "./components/Auth";
import { setSyncStatus, syncIntervals } from "./settings";
import { shouldSync, sync } from "./sync";
import { configPage, authConfigKey, syncIntervalKey, extensionId } from "./constants";

export default runExtension({
  extensionId,
  run: async () => {
    const { pageUid, observer } = await createConfigObserver({ title: configPage, config: {
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
      callback: () => {
        if (!window.roamMatterIsSyncing) {
          sync();
        }
      },
    });

    window.roamMatterSyncInterval = setInterval(shouldSync, 60 * 1000) as any;
    await setSyncStatus(false);
    return {
      observers: [observer]
    };
  },
  unload: () => {
    if (window.roamMatterSyncInterval) {
      clearInterval(window.roamMatterSyncInterval);
    }
    window.roamAlphaAPI.ui.commandPalette.removeCommand({
      label: "Sync with Matter",
    });
  },
});