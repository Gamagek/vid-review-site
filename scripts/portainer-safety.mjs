import { isDeepStrictEqual } from 'node:util';
import { parseDocument } from 'yaml';

const record = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const identifier = /^[a-zA-Z][a-zA-Z0-9_.-]*$/;

export function readCompose(content, label) {
  let config;
  try {
    const doc = parseDocument(content, { uniqueKeys: true, merge: true, prettyErrors: false, logLevel: 'silent' });
    if (doc.errors.length || doc.warnings.length) throw new Error();
    config = doc.toJS({ maxAliasCount: 100 });
  } catch {
    // Parser messages can include snippets of an inline secret. Never propagate them.
    throw new Error(label + ' Compose YAML cannot be parsed safely');
  }
  if (!record(config) || !record(config.services) || !Object.keys(config.services).length ||
      Object.entries(config.services).some(([name, service]) => !identifier.test(name) || !record(service))) {
    throw new Error(label + ' Compose services are invalid');
  }
  return config;
}

export function verifyPreservation(previous, candidate) {
  if (!isDeepStrictEqual(previous.name, candidate.name)) {
    throw new Error('Deployment changes the Compose project name');
  }
  for (const name of ['app', 'cloudflared', 'rapidapi-tester']) {
    if (!candidate.services[name]) throw new Error('Required production service missing: ' + name);
  }
  for (const [name, service] of Object.entries(previous.services)) {
    const next = candidate.services[name];
    if (!next) throw new Error('Deployment would remove an existing service: ' + name);
    // Conservatively require identical mount declarations, including access mode and options.
    // A change in syntax can be reviewed manually; it must not silently change live storage.
    for (const field of ['volumes', 'volumes_from', 'container_name', 'networks', 'network_mode', 'ports', 'profiles', 'configs', 'secrets']) {
      if (!isDeepStrictEqual(service[field], next[field])) {
        throw new Error('Deployment changes protected ' + field + ' configuration for ' + name);
      }
    }
    if (!isDeepStrictEqual(service.deploy?.replicas, next.deploy?.replicas)) {
      throw new Error('Deployment changes the existing replica count for ' + name);
    }
    for (const mount of service.volumes || []) {
      if ((typeof mount === 'string' && !mount.includes(':')) ||
          (record(mount) && (mount.type || 'volume') === 'volume' && !mount.source)) {
        throw new Error('Anonymous persistent volume requires independent review for ' + name);
      }
    }
  }
  for (const field of ['volumes', 'networks', 'configs', 'secrets']) {
    const oldDefinitions = previous[field] || {};
    const newDefinitions = candidate[field] || {};
    if (!record(oldDefinitions) || !record(newDefinitions)) throw new Error('Invalid top-level ' + field + ' configuration');
    for (const [name, definition] of Object.entries(oldDefinitions)) {
      if (!Object.hasOwn(newDefinitions, name) ||
          !isDeepStrictEqual(definition || {}, newDefinitions[name] || {})) {
        throw new Error('Deployment changes an existing top-level ' + field + ' definition');
      }
    }
  }
  if (!previous.services.cloudflared ||
      !isDeepStrictEqual(previous.services.cloudflared, candidate.services.cloudflared)) {
    throw new Error('Management Tunnel service must remain unchanged during automatic deployment');
  }
  return Object.keys(candidate.services);
}

export function containerFailures(containers, compose) {
  if (!Array.isArray(containers)) throw new Error('Unexpected Docker container inventory');
  const failures = [];
  for (const [name, service] of Object.entries(compose.services)) {
    const members = containers.filter(c => c.Labels?.['com.docker.compose.project'] === 'video-site' &&
      c.Labels?.['com.docker.compose.service'] === name &&
      String(c.Labels?.['com.docker.compose.oneoff'] || '').toLowerCase() !== 'true');
    const replicas = Number(service.deploy?.replicas ?? 1);
    if (!Number.isInteger(replicas) || replicas < 1) {
      throw new Error('Inactive services or invalid replica counts require independent review');
    }
    if (members.length < replicas) { failures.push(name + ':missing'); continue; }
    for (const c of members) {
      if (c.State !== 'running') { failures.push(name + ':not-running'); continue; }
      if (/unhealthy/i.test(c.Status || '')) { failures.push(name + ':unhealthy'); continue; }
      const needsHealth = service.healthcheck && !service.healthcheck.disable &&
        service.healthcheck.test?.[0] !== 'NONE';
      if (needsHealth && !/\(healthy\)/i.test(c.Status || '')) failures.push(name + ':not-healthy-yet');
    }
  }
  return [...new Set(failures)];
}
