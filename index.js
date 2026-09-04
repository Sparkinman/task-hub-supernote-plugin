/**
 * Task Hub — entry point
 *
 * Registers a single lasso-toolbar button (type 2). Lasso a handwritten or typed
 * task on a NOTE page (or an annotation in DOC), tap the button, and the selection
 * is pushed to a Radicale CalDAV collection as a VTODO.
 *
 * @format
 */

import {AppRegistry, Image} from 'react-native';
import App from './App';
import {name as appName} from './app.json';

import {PluginManager} from 'sn-plugin-lib';

// MUST come before PluginManager.init() — init depends on the registered component.
AppRegistry.registerComponent(appName, () => App);

PluginManager.init();

// Main toolbar button (type 1): opens the task list directly, with no selection
// required. This is the entry point for reviewing tasks rather than capturing one.
PluginManager.registerButton(1, ['NOTE', 'DOC'], {
  id: 100,
  name: 'Task Hub',
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  showType: 1,
});

// Lasso toolbar button. editDataTypes is the 0-5 lasso index (NOT ElementType):
//   0=stroke  1=title  2=picture  3=text  4=link  5=geometry
// We surface the button for the three that can carry task text.
PluginManager.registerButton(2, ['NOTE', 'DOC'], {
  id: 200,
  name: 'Task Hub',
  icon: Image.resolveAssetSource(require('./assets/icon.png')).uri,
  editDataTypes: [0, 1, 3],
  showType: 1, // 1 = show plugin UI, 0 = run headless
});

// Settings entry (Radicale URL / credentials / collection). This is the config
// button, not a toolbar button — it appears in the plugin's settings row rather
// than competing for space in the NOTE/DOC toolbar.
PluginManager.registerConfigButton();
