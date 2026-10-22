const { validateExport } = require('./validate-export');
const { validateImportPackage } = require('./import-sync-contract');
const { decodeEmbeddedAsset } = require('./embedded-assets');
const { behaviorPackageErrors } = require('./behavior-package');
const { selectorEntriesUsing } = require('./build-compiler-identity-manifest');
const { subjectClasses } = require('./selector-match');
const postcss = require('postcss');

const SHA_256 = /^[a-f0-9]{64}$/;
const LEGACY_MESSAGE = 'This is an earlier package with a separate asset folder. Compile again with Toolkit 0.2.';

function isImage2Value(value) {
  return value && typeof value === 'object'
    && Number(value.image_id) > 0
    && typeof value.src === 'string'
    && value.src.length > 0;
}

function validateSyncSources(syncPackage, layout) {
  const errors = [];
  for (const identity of Array.isArray(syncPackage?.classes) ? syncPackage.classes : []) {
    const collection = layout?.[`${identity.collection}ClassNameCollection`]?.map || {};
    const matches = Object.values(collection).filter(item => item?.value === identity.name);
    if (matches.length !== 1) {
      errors.push(`sync class ${identity.collection}/${identity.name} must match exactly one clipboard class, found ${matches.length}`);
    }
  }
  return errors;
}

// Optional wrapper.externalClasses: classes of the target site that layers use
// by name. Each is one clipboard class, is not managed by syncPackage and has
// no rule in any selector collection; the list is sorted by name.
const EXTERNAL_CLASS = /^-?[_a-zA-Z][_a-zA-Z0-9-]*$/;
function externalClassErrors(wrapper, layout) {
  const list = wrapper.externalClasses;
  if (!Array.isArray(list)) return ['externalClasses must be an array'];
  const errors = [];
  list.forEach((item, index) => {
    const keys = item && typeof item === 'object' && !Array.isArray(item) ? Object.keys(item).sort().join(',') : '';
    if (keys !== 'collection,name' || typeof item.name !== 'string' || !EXTERNAL_CLASS.test(item.name) || !['main', 'design'].includes(item.collection)) {
      errors.push(`externalClasses[${index}] must be { name: <class name>, collection: "main" | "design" }`);
    }
  });
  if (errors.length) return errors;
  if (list.some((item, index) => index > 0 && list[index - 1].name >= item.name)) errors.push('externalClasses must be sorted by name without duplicates');
  const managed = new Set((Array.isArray(wrapper.syncPackage?.classes) ? wrapper.syncPackage.classes : []).map(item => item?.name));
  for (const { name, collection } of list) {
    const matches = Object.values(layout?.[`${collection}ClassNameCollection`]?.map || {}).filter(item => item?.value === name);
    if (matches.length !== 1) errors.push(`external class ${collection}/${name} must match exactly one clipboard class, found ${matches.length}`);
    if (managed.has(name)) errors.push(`external class ${name} is also a managed class in syncPackage`);
    for (const { collection, entry } of selectorEntriesUsing(layout, [name])) errors.push(`external class ${name} has a rule in ${collection}: ${entry.selectorText}`);
  }
  if (!errors.length && Array.isArray(wrapper.behaviorPackages)) errors.push(...behaviorTargetErrors(wrapper.behaviorPackages, new Set(list.map(item => item.name))));
  return errors;
}

// A behavior Embed must not select a site class. Its CSS rules (the Embed
// stylesheet, a reveal's visibility rule) must not have one as subject. Its
// script's `const config = {…};` (every Toolkit adapter writes one) must not
// name one: `*Class` values are class names, `*Selector` values selectors
// whose subject counts. A script without that object is read string by string
// (both quote kinds), each as a name and as a selector. A site class as
// context is allowed.
const CONFIG_OBJECT = /const config = (\{[^\n]*\});/;
function scriptTargets(script, external) {
  const found = new Set();
  const check = (value, asSelector) => {
    if (typeof value !== 'string') return;
    if (!asSelector && external.has(value.replace(/^\./, ''))) found.add(value.replace(/^\./, ''));
    if (asSelector) for (const name of subjectClasses(value)) if (external.has(name)) found.add(name);
  };
  const match = CONFIG_OBJECT.exec(script);
  let config = null;
  if (match) { try { config = JSON.parse(match[1]); } catch { config = null; } }
  if (config && typeof config === 'object') {
    for (const [key, value] of Object.entries(config)) {
      if (/Class$/.test(key)) check(value, false);
      else if (/Selector$/.test(key)) check(value, true);
    }
    return found;
  }
  for (const literal of script.matchAll(/"((?:[^"\\]|\\.)*)"|'((?:[^'\\]|\\.)*)'/g)) {
    const value = literal[1] ?? literal[2];
    check(value, false);
    check(value, true);
  }
  return found;
}

function behaviorTargetErrors(packages, external) {
  const errors = [];
  packages.forEach((item, index) => {
    const tags = item?.clipboardData?.copiedLayout?.tree?.tags || {};
    const code = tags[item?.clipboardData?.copiedLayout?.tree?.root]?.embedCode;
    if (typeof code !== 'string') return;
    const label = `behaviorPackages[${index}] (${item.key})`;
    const found = new Set();
    for (const [, css] of code.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/gi)) {
      try { postcss.parse(css).walkRules(rule => { for (const selector of rule.selectors) for (const name of subjectClasses(selector.trim())) if (external.has(name)) found.add(name); }); }
      catch { errors.push(`${label} has CSS that cannot be parsed`); }
    }
    for (const [, script] of code.matchAll(/<script[^>]*>([\s\S]*?)<\/script>/gi)) {
      for (const name of scriptTargets(script, external)) found.add(name);
    }
    for (const name of found) errors.push(`${label} targets external class ${name}`);
  });
  return errors;
}

function preflightImportPackage(wrapper) {
  const errors = [];
  const warnings = [];
  const empty = { nodes: 0, classes: 0, instances: 0, assets: 0 };
  if (!wrapper || typeof wrapper !== 'object' || Array.isArray(wrapper)) {
    return { ok: false, errors: ['Import wrapper must be an object'], warnings, summary: empty, stats: empty, package: null };
  }
  if (wrapper.version === 1) {
    return { ok: false, errors: [LEGACY_MESSAGE], warnings, summary: empty, stats: empty, package: null };
  }
  if (wrapper.type !== 'taptop-enhancer-layer-export') errors.push('wrapper.type must be taptop-enhancer-layer-export');
  if (wrapper.version !== 2) errors.push('wrapper.version must equal 2');
  if (typeof wrapper.sourceRevision !== 'string' || !SHA_256.test(wrapper.sourceRevision)) {
    errors.push('sourceRevision must be a lowercase SHA-256 hex string');
  }
  if (/([?&]|\b)access=/i.test(String(wrapper.sourceUrl || ''))) {
    errors.push('sourceUrl contains a secret-bearing access parameter');
  }
  if (!wrapper.clipboardData) errors.push('clipboardData is required');
  else errors.push(...validateExport(wrapper.clipboardData));
  if (!wrapper.syncPackage) errors.push('syncPackage is required for managed compiler imports');
  else errors.push(...validateImportPackage(wrapper.syncPackage));
  if (wrapper.syncPackage?.sourceRevision !== undefined && wrapper.syncPackage.sourceRevision !== wrapper.sourceRevision) {
    errors.push('syncPackage.sourceRevision differs from wrapper.sourceRevision');
  }
  if (wrapper.behaviorPackages !== undefined) errors.push(...behaviorPackageErrors(wrapper.behaviorPackages));

  const assetsByKey = new Map();
  if (!Array.isArray(wrapper.embeddedAssets)) errors.push('embeddedAssets must be an array');
  else for (const asset of wrapper.embeddedAssets) {
    if (assetsByKey.has(asset?.stableKey)) errors.push(`Duplicate embedded asset stableKey: ${asset.stableKey}`);
    else assetsByKey.set(asset?.stableKey, asset);
    try { decodeEmbeddedAsset(asset); }
    catch (error) { errors.push(`Embedded asset ${asset?.stableKey || '?'}: ${error.message}`); }
  }

  const layout = wrapper.clipboardData?.copiedLayout;
  if (wrapper.syncPackage && layout) errors.push(...validateSyncSources(wrapper.syncPackage, layout));
  if (wrapper.externalClasses !== undefined) errors.push(...externalClassErrors(wrapper, layout));
  const tags = Object.values(layout?.tree?.tags || {});
  const pending = tags.filter(tag => tag?.__pendingUpload);
  for (const tag of pending) {
    const upload = tag.__pendingUpload;
    if (typeof upload.assetKey !== 'string' || !upload.assetKey) {
      errors.push(`tag ${tag.id || '?'} pending upload needs an assetKey`);
    } else if (!assetsByKey.has(upload.assetKey)) {
      errors.push(`tag ${tag.id || '?'} assetKey is absent from embeddedAssets: ${upload.assetKey}`);
    }
    if (Object.keys(upload).some(key => key !== 'assetKey')) {
      errors.push(`tag ${tag.id || '?'} pending upload must use assetKey only`);
    }
  }
  for (const tag of tags.filter(item => item?.widgetName === 'image__img')) {
    const hasPending = typeof tag.__pendingUpload?.assetKey === 'string' && tag.__pendingUpload.assetKey.length > 0;
    if (tag.data?.src?.type === 'IMAGE2' && isImage2Value(tag.data.src.value)) {
      errors.push(`tag ${tag.id || '?'} portable image must not contain a target media ID`);
    }
    if (!hasPending) errors.push(`tag ${tag.id || '?'} image payload needs __pendingUpload.assetKey`);
  }
  if (pending.length) warnings.push(`${pending.length} image upload(s) need the Taptop import bridge`);

  const summary = {
    nodes: tags.length,
    classes: wrapper.syncPackage?.classes?.length || 0,
    instances: wrapper.syncPackage?.instances?.length || 0,
    assets: Array.isArray(wrapper.embeddedAssets) ? wrapper.embeddedAssets.length : 0
  };
  const stats = {
    tags: summary.nodes,
    managedClasses: summary.classes,
    managedInstances: summary.instances,
    pendingUploads: pending.length
  };
  return { ok: errors.length === 0, errors, warnings, summary, stats, package: errors.length === 0 ? wrapper : null };
}

module.exports = { LEGACY_MESSAGE, preflightImportPackage };
