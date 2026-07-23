const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const ASSET_VERSION_TOKEN = '__SNEUP_ASSET_VERSION__';
const FINGERPRINTED_ASSETS = Object.freeze(['app.js', 'styles.css', 'favicon.svg']);
const IMMUTABLE_CACHE_CONTROL = 'public, max-age=31536000, immutable';
const HTML_CACHE_CONTROL = 'no-cache';

const readFile = (directory, fileName) => fs.readFileSync(path.join(directory, fileName));

const fingerprint = (directory, assetNames = FINGERPRINTED_ASSETS) => {
  const hash = crypto.createHash('sha256');
  assetNames.forEach(assetName => {
    hash.update(assetName);
    hash.update(readFile(directory, assetName));
  });
  return hash.digest('hex').slice(0, 16);
};

const buildAssets = (directory) => {
  const version = fingerprint(directory);
  const template = fs.readFileSync(path.join(directory, 'index.html'), 'utf8');
  if (!template.includes(ASSET_VERSION_TOKEN)) {
    throw new Error('Command center HTML is missing the static asset version token');
  }

  return {
    directory,
    version,
    assetPaths: new Set(FINGERPRINTED_ASSETS.map(assetName => `/${assetName}`)),
    html: template.replaceAll(ASSET_VERSION_TOKEN, version)
  };
};

const cacheControlFor = (assets, requestPath, version) => {
  if (requestPath === '/' || requestPath === '/index.html') return HTML_CACHE_CONTROL;
  if (assets.assetPaths.has(requestPath) && version === assets.version) return IMMUTABLE_CACHE_CONTROL;
  return null;
};

const createMiddleware = (assets) => (req, res, next) => {
  if (!['GET', 'HEAD'].includes(req.method)) return next();
  const cacheControl = cacheControlFor(assets, req.path, req.query?.v);
  if (req.path === '/' || req.path === '/index.html') {
    res.set('Cache-Control', cacheControl);
    return res.type('html').send(assets.html);
  }
  if (cacheControl) res.locals.commandCenterCacheControl = cacheControl;
  return next();
};

const staticHeaders = (res) => {
  if (res.locals.commandCenterCacheControl) {
    res.setHeader('Cache-Control', res.locals.commandCenterCacheControl);
  }
};

module.exports = {
  ASSET_VERSION_TOKEN,
  FINGERPRINTED_ASSETS,
  IMMUTABLE_CACHE_CONTROL,
  HTML_CACHE_CONTROL,
  buildAssets,
  cacheControlFor,
  createMiddleware,
  staticHeaders
};
