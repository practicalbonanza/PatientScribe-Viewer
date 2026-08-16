/**
 * What the built distribution has to look like, read back from the control
 * plane.
 *
 * This is the half of the deploy gate that no live request can make. The release
 * check reads the wire and can tell you what a response carried; it cannot tell
 * you that the eleven error statuses are configured to pass through, because a
 * status nothing provoked produces no response to read. So these are read from
 * the configuration itself, and they are read back after the change set was
 * applied rather than diffed before it: a template says what was asked for, and
 * this says what is there.
 *
 * Usage:
 *   node assert-distribution-core.mjs --read-output <stacks.json> <OutputKey>
 *   node assert-distribution-core.mjs --assert <stacks.json> <distribution.json> <alarms.json>
 *                                     [--expected-alarm-action <value>]
 *   node assert-distribution-core.mjs --self-test
 *
 * Exit codes: 0 = every assertion held, 1 = one did not, 2 = it could not run.
 *
 * The engine is separated from the calls that fetch its inputs for the reason
 * every check in this repository is: the assertions take JSON and return
 * refusals, so both directions of every one of them can be exercised from canned
 * documents without AWS in the room. A check whose failing direction has never
 * run is a check nobody has seen work.
 *
 * The expected alarm action and threshold come from outside, and both are
 * required. The topic is a private value so it cannot be written here, but
 * "cannot be written here" is not the same as "optional": a run that was handed
 * no expected topic and checked only that there was exactly one action would pass
 * an alarm notifying somewhere else entirely, and it would pass it quietly. So a
 * missing expectation is a refusal, named as one, rather than a weaker check that
 * still prints PASS. The shape is asserted as well — one alarm action, no OK
 * action, no insufficient-data action — because "notification only" is a claim
 * about what the alarm cannot do.
 */

import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * The statuses a distribution can be told something about, and the whole list.
 *
 * Written out rather than derived from what the distribution carries, which
 * would be a list that agrees with whatever it is shown.
 *
 * @type {readonly number[]}
 */
export const ERROR_STATUSES = Object.freeze([400, 403, 404, 405, 414, 416, 500, 501, 502, 503, 504]);

/** The asset behaviour's path pattern, exactly. */
export const ASSET_PATH_PATTERN = '/assets/*';

/** The entry point, exactly. */
export const DEFAULT_ROOT_OBJECT = 'index.html';

/**
 * @param {unknown} value
 * @returns {Record<string, unknown> | null}
 */
function asObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    return null;
  }
  return /** @type {Record<string, unknown>} */ (value);
}

/**
 * @param {unknown} value
 * @returns {unknown[] | null}
 */
function asArray(value) {
  return Array.isArray(value) ? value : null;
}

/**
 * The `Quantity`/`Items` shape CloudFront answers with, read as a plain list.
 *
 * An absent block and an empty one are the same thing to every assertion here,
 * so they are made the same thing once, here, rather than at each call site.
 *
 * @param {unknown} value
 * @returns {Record<string, unknown>[]}
 */
function items(value) {
  const block = asObject(value);
  if (block === null) {
    return [];
  }
  const list = asArray(block['Items']);
  if (list === null) {
    return [];
  }
  /** @type {Record<string, unknown>[]} */
  const out = [];
  for (const entry of list) {
    const record = asObject(entry);
    if (record !== null) {
      out.push(record);
    }
  }
  return out;
}

/**
 * Every stack output, by key.
 *
 * @param {unknown} stacks The `describe-stacks` document.
 * @returns {Map<string, string>}
 */
export function stackOutputs(stacks) {
  /** @type {Map<string, string>} */
  const out = new Map();
  const root = asObject(stacks);
  const list = root === null ? null : asArray(root['Stacks']);
  const first = list === null ? null : asObject(list[0]);
  const outputs = first === null ? null : asArray(first['Outputs']);
  if (outputs === null) {
    return out;
  }
  for (const entry of outputs) {
    const record = asObject(entry);
    if (record === null) {
      continue;
    }
    const key = record['OutputKey'];
    const value = record['OutputValue'];
    if (typeof key === 'string' && typeof value === 'string') {
      out.set(key, value);
    }
  }
  return out;
}

/**
 * Every assertion, against the three documents the calls returned.
 *
 * @param {object} input
 * @param {unknown} input.stacks `cloudformation describe-stacks`
 * @param {unknown} input.distribution `cloudfront get-distribution-config`
 * @param {unknown} input.alarms `cloudwatch describe-alarms`
 * @param {string | null} input.expectedAlarmAction
 * @param {number | null} input.expectedThreshold
 * @returns {string[]} One line per refusal; empty means everything held.
 */
export function assertDistribution({ stacks, distribution, alarms, expectedAlarmAction, expectedThreshold }) {
  /** @type {string[]} */
  const refusals = [];

  const outputs = stackOutputs(stacks);
  const distributionId = outputs.get('DistributionId') ?? '';
  const expectedDefaultPolicy = outputs.get('DefaultResponseHeadersPolicyId') ?? '';
  const expectedAssetPolicy = outputs.get('AssetResponseHeadersPolicyId') ?? '';
  const alarmName = outputs.get('RequestCountAlarmName') ?? '';

  for (const [label, value] of [
    ['DistributionId', distributionId],
    ['DefaultResponseHeadersPolicyId', expectedDefaultPolicy],
    ['AssetResponseHeadersPolicyId', expectedAssetPolicy],
    ['RequestCountAlarmName', alarmName],
  ]) {
    if (value === '') {
      refusals.push(`stack outputs carry no ${label}, and every assertion below is read against it`);
    }
  }

  const configRoot = asObject(distribution);
  const config = configRoot === null ? null : asObject(configRoot['DistributionConfig']);
  if (config === null) {
    refusals.push('the distribution document carries no DistributionConfig');
    return refusals;
  }

  // The entry point.
  const root = config['DefaultRootObject'];
  if (root !== DEFAULT_ROOT_OBJECT) {
    refusals.push(`DefaultRootObject is ${JSON.stringify(root)}, and it must be ${JSON.stringify(DEFAULT_ROOT_OBJECT)}`);
  }

  // IPv6, which prod's AAAA alias record depends on and dev is held to as well.
  // An AAAA record pointing at a distribution with no IPv6 addresses resolves to
  // nothing for a client that asks for one, and nothing about the record itself
  // shows that — the two settings are only wrong together.
  if (config['IsIPV6Enabled'] !== true) {
    refusals.push(
      `IsIPV6Enabled is ${JSON.stringify(config['IsIPV6Enabled'])}, and an AAAA alias against a distribution without IPv6 answers nobody`,
    );
  }

  // The origin, and that it is read through an access control.
  const origins = items(config['Origins']);
  if (origins.length !== 1) {
    refusals.push(`the distribution has ${origins.length} origin(s), and it must have exactly one`);
  }
  for (const origin of origins) {
    const control = origin['OriginAccessControlId'];
    if (typeof control !== 'string' || control === '') {
      refusals.push(
        `origin ${JSON.stringify(origin['Id'])} has no origin access control, so its bucket is reached as something other than this distribution`,
      );
    }
  }

  // The two behaviours, and the policy each carries.
  const defaultBehavior = asObject(config['DefaultCacheBehavior']);
  if (defaultBehavior === null) {
    refusals.push('the distribution has no default cache behaviour');
  } else if (defaultBehavior['ResponseHeadersPolicyId'] !== expectedDefaultPolicy) {
    refusals.push(
      `the default behaviour carries response-headers policy ${JSON.stringify(defaultBehavior['ResponseHeadersPolicyId'])}, and the stack built ${JSON.stringify(expectedDefaultPolicy)}`,
    );
  }

  const behaviors = items(config['CacheBehaviors']);
  if (behaviors.length !== 1) {
    refusals.push(`the distribution has ${behaviors.length} additional behaviour(s), and it must have exactly one`);
  }
  const assetBehavior = behaviors.find((entry) => entry['PathPattern'] === ASSET_PATH_PATTERN);
  if (assetBehavior === undefined) {
    refusals.push(`no behaviour is bound to ${ASSET_PATH_PATTERN}`);
  } else if (assetBehavior['ResponseHeadersPolicyId'] !== expectedAssetPolicy) {
    refusals.push(
      `the ${ASSET_PATH_PATTERN} behaviour carries response-headers policy ${JSON.stringify(assetBehavior['ResponseHeadersPolicyId'])}, and the stack built ${JSON.stringify(expectedAssetPolicy)}`,
    );
  }

  // The error statuses: all eleven, none cached, none answered with a document.
  const errors = items(config['CustomErrorResponses']);
  /** @type {Map<number, Record<string, unknown>>} */
  const byStatus = new Map();
  for (const entry of errors) {
    const code = entry['ErrorCode'];
    if (typeof code === 'number') {
      byStatus.set(code, entry);
    }
  }
  for (const status of ERROR_STATUSES) {
    const entry = byStatus.get(status);
    if (entry === undefined) {
      refusals.push(`${status} has no custom error response, so its caching is whatever the default is rather than none`);
      continue;
    }
    if (entry['ErrorCachingMinTTL'] !== 0) {
      refusals.push(
        `${status} is cached for ${JSON.stringify(entry['ErrorCachingMinTTL'])}, and an error that outlives its cause is the thing this is set to zero for`,
      );
    }
    if (entry['ResponsePagePath'] !== undefined) {
      refusals.push(
        `${status} is answered with ${JSON.stringify(entry['ResponsePagePath'])}, and this origin serves the status that happened rather than a page about it`,
      );
    }
  }
  for (const status of byStatus.keys()) {
    if (!ERROR_STATUSES.includes(status)) {
      refusals.push(`${status} has a custom error response, and it is not one of the eleven this design configures`);
    }
  }

  // The alarm, in full.
  refusals.push(...assertAlarm({ alarms, alarmName, distributionId, expectedAlarmAction, expectedThreshold }));

  return refusals;
}

/**
 * The alarm's whole shape, not just its existence.
 *
 * Every field is read because every one of them is load-bearing: an alarm on the
 * right metric with the wrong dimensions watches nothing, an alarm with the
 * comparison the other way round fires constantly and gets muted, and an alarm
 * that has grown an action is no longer the notification-only thing that was
 * agreed.
 *
 * @param {object} input
 * @param {unknown} input.alarms
 * @param {string} input.alarmName
 * @param {string} input.distributionId
 * @param {string | null} input.expectedAlarmAction
 * @param {number | null} input.expectedThreshold
 * @returns {string[]}
 */
export function assertAlarm({ alarms, alarmName, distributionId, expectedAlarmAction, expectedThreshold }) {
  /** @type {string[]} */
  const refusals = [];

  const root = asObject(alarms);
  const list = root === null ? null : asArray(root['MetricAlarms']);
  /** @type {Record<string, unknown> | undefined} */
  let alarm;
  for (const entry of list ?? []) {
    const record = asObject(entry);
    if (record !== null && record['AlarmName'] === alarmName) {
      alarm = record;
      break;
    }
  }

  if (alarm === undefined) {
    refusals.push(`no alarm named ${JSON.stringify(alarmName)} exists, so nothing is watching request volume`);
    return refusals;
  }

  /** @type {[string, unknown][]} */
  const scalars = [
    ['Namespace', 'AWS/CloudFront'],
    ['MetricName', 'Requests'],
    ['Statistic', 'Sum'],
    ['Period', 300],
    ['EvaluationPeriods', 1],
    ['ComparisonOperator', 'GreaterThanThreshold'],
    ['TreatMissingData', 'notBreaching'],
  ];
  for (const [field, expected] of scalars) {
    if (alarm[field] !== expected) {
      refusals.push(`the alarm's ${field} is ${JSON.stringify(alarm[field])}, and it must be ${JSON.stringify(expected)}`);
    }
  }

  // An alarm with its actions switched off is an alarm that evaluates, goes red,
  // and tells nobody. It is the one drift that looks entirely healthy in a
  // console listing.
  if (alarm['ActionsEnabled'] !== true) {
    refusals.push(
      `the alarm's ActionsEnabled is ${JSON.stringify(alarm['ActionsEnabled'])}, and an alarm that fires without notifying is not a notification`,
    );
  }

  if (expectedThreshold === null) {
    refusals.push('no expected threshold was supplied, and a threshold nothing is compared against is not being checked');
  } else if (alarm['Threshold'] !== expectedThreshold) {
    refusals.push(
      `the alarm's Threshold is ${JSON.stringify(alarm['Threshold'])}, and this deploy was built for ${JSON.stringify(expectedThreshold)}`,
    );
  }

  /** @type {Map<string, unknown>} */
  const dimensions = new Map();
  for (const entry of asArray(alarm['Dimensions']) ?? []) {
    const record = asObject(entry);
    if (record !== null && typeof record['Name'] === 'string') {
      dimensions.set(record['Name'], record['Value']);
    }
  }
  if (dimensions.size !== 2) {
    refusals.push(`the alarm carries ${dimensions.size} dimension(s), and the metric is published under exactly two`);
  }
  if (dimensions.get('DistributionId') !== distributionId) {
    refusals.push(
      `the alarm's DistributionId dimension is ${JSON.stringify(dimensions.get('DistributionId'))}, and this stack's distribution is a different one`,
    );
  }
  if (dimensions.get('Region') !== 'Global') {
    refusals.push(
      `the alarm's Region dimension is ${JSON.stringify(dimensions.get('Region'))}, and CloudFront publishes this metric under "Global"`,
    );
  }

  const alarmActions = asArray(alarm['AlarmActions']) ?? [];
  const okActions = asArray(alarm['OKActions']) ?? [];
  const insufficient = asArray(alarm['InsufficientDataActions']) ?? [];

  if (alarmActions.length !== 1) {
    refusals.push(`the alarm has ${alarmActions.length} alarm action(s), and notification-only means exactly one`);
  }
  if (okActions.length !== 0) {
    refusals.push(`the alarm has ${okActions.length} OK action(s), and it was agreed to have none`);
  }
  if (insufficient.length !== 0) {
    refusals.push(`the alarm has ${insufficient.length} insufficient-data action(s), and it was agreed to have none`);
  }
  if (expectedAlarmAction === null) {
    refusals.push(
      'no expected alarm action was supplied, and "exactly one action" says nothing about whether it is the right one — supply it from the overlay or with --expected-alarm-action',
    );
  } else if (alarmActions.length === 1 && alarmActions[0] !== expectedAlarmAction) {
    refusals.push('the alarm notifies somewhere other than the topic this deploy was given');
  }

  return refusals;
}

// ---------------------------------------------------------------------------
// The command line
// ---------------------------------------------------------------------------

/**
 * @param {string} message
 * @returns {never}
 */
function cannotRun(message) {
  process.stderr.write(`assert-distribution — cannot run: ${message}\n`);
  process.exit(2);
}

/**
 * @param {string} file
 * @returns {unknown}
 */
function readJson(file) {
  /** @type {string} */
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    return cannotRun(`cannot open ${file}`);
  }
  try {
    return JSON.parse(text);
  } catch (error) {
    return cannotRun(`${file} is not JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

// ---------------------------------------------------------------------------
// The self-test
// ---------------------------------------------------------------------------

/**
 * A conforming set of the three documents.
 *
 * Deliberately not read from a real deploy. These are what the assertions say
 * conformance is, written down, so a mutation of one of them is a precise
 * statement of one way a distribution can be wrong.
 *
 * @returns {{stacks: Record<string, unknown>, distribution: Record<string, unknown>, alarms: Record<string, unknown>}}
 */
function conformingDocuments() {
  const stacks = {
    Stacks: [
      {
        StackName: 'patientscribe-viewer-dev',
        Outputs: [
          { OutputKey: 'DistributionId', OutputValue: 'EXAMPLEDISTID' },
          { OutputKey: 'DefaultResponseHeadersPolicyId', OutputValue: 'policy-default' },
          { OutputKey: 'AssetResponseHeadersPolicyId', OutputValue: 'policy-assets' },
          { OutputKey: 'RequestCountAlarmName', OutputValue: 'patientscribe-viewer-dev-requests' },
          // The threshold the stack states it was deployed with. The fetching
          // half reads the expectation from here rather than from a local file,
          // so a conforming document carries it.
          { OutputKey: 'RequestCountAlarmThreshold', OutputValue: '10000' },
        ],
      },
    ],
  };

  const distribution = {
    DistributionConfig: {
      DefaultRootObject: 'index.html',
      IsIPV6Enabled: true,
      Origins: { Quantity: 1, Items: [{ Id: 'viewer-origin', OriginAccessControlId: 'oac-1' }] },
      DefaultCacheBehavior: { TargetOriginId: 'viewer-origin', ResponseHeadersPolicyId: 'policy-default' },
      CacheBehaviors: {
        Quantity: 1,
        Items: [{ PathPattern: '/assets/*', TargetOriginId: 'viewer-origin', ResponseHeadersPolicyId: 'policy-assets' }],
      },
      CustomErrorResponses: {
        Quantity: ERROR_STATUSES.length,
        Items: ERROR_STATUSES.map((code) => ({ ErrorCode: code, ErrorCachingMinTTL: 0 })),
      },
    },
  };

  const alarms = {
    MetricAlarms: [
      {
        AlarmName: 'patientscribe-viewer-dev-requests',
        Namespace: 'AWS/CloudFront',
        MetricName: 'Requests',
        Dimensions: [
          { Name: 'DistributionId', Value: 'EXAMPLEDISTID' },
          { Name: 'Region', Value: 'Global' },
        ],
        Statistic: 'Sum',
        Period: 300,
        EvaluationPeriods: 1,
        ComparisonOperator: 'GreaterThanThreshold',
        TreatMissingData: 'notBreaching',
        Threshold: 10000,
        ActionsEnabled: true,
        AlarmActions: ['topic-under-test'],
        OKActions: [],
        InsufficientDataActions: [],
      },
    ],
    CompositeAlarms: [],
  };

  return { stacks, distribution, alarms };
}

/**
 * @returns {number} process exit code
 */
function selfTest() {
  /** @type {{name: string, mutate: (docs: ReturnType<typeof conformingDocuments>) => void, expect: string}[]} */
  const cases = [
    {
      name: 'the entry point is something else',
      mutate: (d) => {
        const c = /** @type {Record<string, unknown>} */ (d.distribution['DistributionConfig']);
        c['DefaultRootObject'] = 'home.html';
      },
      expect: 'DefaultRootObject',
    },
    {
      name: 'IPv6 is switched off',
      mutate: (d) => {
        const c = /** @type {Record<string, unknown>} */ (d.distribution['DistributionConfig']);
        c['IsIPV6Enabled'] = false;
      },
      expect: 'IsIPV6Enabled',
    },
    {
      name: 'the alarm threshold has drifted',
      mutate: (d) => {
        const list = /** @type {Record<string, unknown>[]} */ (d.alarms['MetricAlarms']);
        const alarm = list[0];
        if (alarm !== undefined) {
          alarm['Threshold'] = 50;
        }
      },
      expect: "the alarm's Threshold is 50",
    },
    {
      name: 'the alarm has its actions switched off',
      mutate: (d) => {
        const list = /** @type {Record<string, unknown>[]} */ (d.alarms['MetricAlarms']);
        const alarm = list[0];
        if (alarm !== undefined) {
          alarm['ActionsEnabled'] = false;
        }
      },
      expect: 'ActionsEnabled',
    },
    {
      name: 'one of the eleven statuses is not configured',
      mutate: (d) => {
        const c = /** @type {Record<string, unknown>} */ (d.distribution['DistributionConfig']);
        const block = /** @type {Record<string, unknown>} */ (c['CustomErrorResponses']);
        const list = /** @type {unknown[]} */ (block['Items']);
        block['Items'] = list.filter((e) => /** @type {Record<string, unknown>} */ (e)['ErrorCode'] !== 416);
      },
      expect: '416 has no custom error response',
    },
    {
      name: 'an error status is cached',
      mutate: (d) => {
        const c = /** @type {Record<string, unknown>} */ (d.distribution['DistributionConfig']);
        const block = /** @type {Record<string, unknown>} */ (c['CustomErrorResponses']);
        const list = /** @type {Record<string, unknown>[]} */ (block['Items']);
        const entry = list[0];
        if (entry !== undefined) {
          entry['ErrorCachingMinTTL'] = 10;
        }
      },
      expect: 'is cached for 10',
    },
    {
      name: 'an error status is answered with a document',
      mutate: (d) => {
        const c = /** @type {Record<string, unknown>} */ (d.distribution['DistributionConfig']);
        const block = /** @type {Record<string, unknown>} */ (c['CustomErrorResponses']);
        const list = /** @type {Record<string, unknown>[]} */ (block['Items']);
        const entry = list[0];
        if (entry !== undefined) {
          entry['ResponsePagePath'] = '/error.html';
        }
      },
      expect: 'is answered with',
    },
    {
      name: 'a status outside the eleven is configured',
      mutate: (d) => {
        const c = /** @type {Record<string, unknown>} */ (d.distribution['DistributionConfig']);
        const block = /** @type {Record<string, unknown>} */ (c['CustomErrorResponses']);
        const list = /** @type {Record<string, unknown>[]} */ (block['Items']);
        list.push({ ErrorCode: 418, ErrorCachingMinTTL: 0 });
      },
      expect: '418 has a custom error response',
    },
    {
      name: 'the origin is not read through an access control',
      mutate: (d) => {
        const c = /** @type {Record<string, unknown>} */ (d.distribution['DistributionConfig']);
        const block = /** @type {Record<string, unknown>} */ (c['Origins']);
        const list = /** @type {Record<string, unknown>[]} */ (block['Items']);
        const entry = list[0];
        if (entry !== undefined) {
          entry['OriginAccessControlId'] = '';
        }
      },
      expect: 'no origin access control',
    },
    {
      name: 'the default behaviour carries a different policy',
      mutate: (d) => {
        const c = /** @type {Record<string, unknown>} */ (d.distribution['DistributionConfig']);
        const behavior = /** @type {Record<string, unknown>} */ (c['DefaultCacheBehavior']);
        behavior['ResponseHeadersPolicyId'] = 'policy-somewhere-else';
      },
      expect: 'the default behaviour carries response-headers policy',
    },
    {
      name: 'the asset behaviour carries a different policy',
      mutate: (d) => {
        const c = /** @type {Record<string, unknown>} */ (d.distribution['DistributionConfig']);
        const block = /** @type {Record<string, unknown>} */ (c['CacheBehaviors']);
        const list = /** @type {Record<string, unknown>[]} */ (block['Items']);
        const entry = list[0];
        if (entry !== undefined) {
          entry['ResponseHeadersPolicyId'] = 'policy-somewhere-else';
        }
      },
      expect: 'behaviour carries response-headers policy',
    },
    {
      name: 'nothing is bound to the asset path',
      mutate: (d) => {
        const c = /** @type {Record<string, unknown>} */ (d.distribution['DistributionConfig']);
        const block = /** @type {Record<string, unknown>} */ (c['CacheBehaviors']);
        block['Items'] = [];
      },
      expect: 'no behaviour is bound to /assets/*',
    },
    {
      name: 'the alarm is absent',
      mutate: (d) => {
        d.alarms['MetricAlarms'] = [];
      },
      expect: 'no alarm named',
    },
    {
      name: 'the alarm watches the wrong dimension',
      mutate: (d) => {
        const list = /** @type {Record<string, unknown>[]} */ (d.alarms['MetricAlarms']);
        const alarm = list[0];
        if (alarm !== undefined) {
          alarm['Dimensions'] = [
            { Name: 'DistributionId', Value: 'EXAMPLEDISTID' },
            { Name: 'Region', Value: 'us-east-1' },
          ];
        }
      },
      expect: 'Region dimension',
    },
    {
      name: 'the alarm compares the wrong way round',
      mutate: (d) => {
        const list = /** @type {Record<string, unknown>[]} */ (d.alarms['MetricAlarms']);
        const alarm = list[0];
        if (alarm !== undefined) {
          alarm['ComparisonOperator'] = 'LessThanThreshold';
        }
      },
      expect: 'ComparisonOperator',
    },
    {
      name: 'the alarm has an action beyond the topic',
      mutate: (d) => {
        const list = /** @type {Record<string, unknown>[]} */ (d.alarms['MetricAlarms']);
        const alarm = list[0];
        if (alarm !== undefined) {
          alarm['AlarmActions'] = ['topic-under-test', 'something-that-acts'];
        }
      },
      expect: 'alarm action(s), and notification-only means exactly one',
    },
    {
      name: 'the alarm has grown an OK action',
      mutate: (d) => {
        const list = /** @type {Record<string, unknown>[]} */ (d.alarms['MetricAlarms']);
        const alarm = list[0];
        if (alarm !== undefined) {
          alarm['OKActions'] = ['something-that-acts'];
        }
      },
      expect: 'OK action(s)',
    },
    {
      name: 'the alarm has grown an insufficient-data action',
      mutate: (d) => {
        const list = /** @type {Record<string, unknown>[]} */ (d.alarms['MetricAlarms']);
        const alarm = list[0];
        if (alarm !== undefined) {
          alarm['InsufficientDataActions'] = ['something-that-acts'];
        }
      },
      expect: 'insufficient-data action(s)',
    },
    {
      name: 'the alarm is on a different metric',
      mutate: (d) => {
        const list = /** @type {Record<string, unknown>[]} */ (d.alarms['MetricAlarms']);
        const alarm = list[0];
        if (alarm !== undefined) {
          alarm['MetricName'] = 'BytesDownloaded';
        }
      },
      expect: 'MetricName',
    },
    {
      name: 'the alarm reads a different period',
      mutate: (d) => {
        const list = /** @type {Record<string, unknown>[]} */ (d.alarms['MetricAlarms']);
        const alarm = list[0];
        if (alarm !== undefined) {
          alarm['Period'] = 60;
        }
      },
      expect: 'Period',
    },
    {
      name: 'the alarm fires on quiet',
      mutate: (d) => {
        const list = /** @type {Record<string, unknown>[]} */ (d.alarms['MetricAlarms']);
        const alarm = list[0];
        if (alarm !== undefined) {
          alarm['TreatMissingData'] = 'breaching';
        }
      },
      expect: 'TreatMissingData',
    },
    {
      name: 'the alarm notifies somewhere else',
      mutate: (d) => {
        const list = /** @type {Record<string, unknown>[]} */ (d.alarms['MetricAlarms']);
        const alarm = list[0];
        if (alarm !== undefined) {
          alarm['AlarmActions'] = ['a-different-topic'];
        }
      },
      expect: 'notifies somewhere other than the topic',
    },
  ];

  let failures = 0;

  const clean = conformingDocuments();
  const cleanRefusals = assertDistribution({
    stacks: clean.stacks,
    distribution: clean.distribution,
    alarms: clean.alarms,
    expectedAlarmAction: 'topic-under-test',
    expectedThreshold: 10000,
  });
  if (cleanRefusals.length === 0) {
    process.stdout.write('  ok   a conforming distribution raises nothing\n');
  } else {
    failures += 1;
    process.stdout.write(`  FAIL a conforming distribution raised ${cleanRefusals.length}:\n`);
    for (const line of cleanRefusals) {
      process.stdout.write(`         ${line}\n`);
    }
  }

  for (const testCase of cases) {
    const docs = conformingDocuments();
    testCase.mutate(docs);
    const refusals = assertDistribution({
      stacks: docs.stacks,
      distribution: docs.distribution,
      alarms: docs.alarms,
      expectedAlarmAction: 'topic-under-test',
      expectedThreshold: 10000,
    });
    const matched = refusals.some((line) => line.includes(testCase.expect));
    if (matched) {
      process.stdout.write(`  ok   ${testCase.name}\n`);
    } else {
      failures += 1;
      process.stdout.write(`  FAIL ${testCase.name} — nothing refused with ${JSON.stringify(testCase.expect)}\n`);
      for (const line of refusals) {
        process.stdout.write(`         ${line}\n`);
      }
    }
  }

  // A missing expectation is a refusal rather than a softer check. Both of these
  // used to be the shape of a passing run.
  /** @type {{label: string, action: string | null, threshold: number | null, expect: string}[]} */
  const missing = [
    {
      label: 'no expected alarm action is a refusal, not a shape-only pass',
      action: null,
      threshold: 10000,
      expect: 'no expected alarm action was supplied',
    },
    {
      label: 'no expected threshold is a refusal',
      action: 'topic-under-test',
      threshold: null,
      expect: 'no expected threshold was supplied',
    },
  ];

  for (const testCase of missing) {
    const docs = conformingDocuments();
    const refusals = assertDistribution({
      stacks: docs.stacks,
      distribution: docs.distribution,
      alarms: docs.alarms,
      expectedAlarmAction: testCase.action,
      expectedThreshold: testCase.threshold,
    });
    const matched = refusals.some((line) => line.includes(testCase.expect));
    if (matched) {
      process.stdout.write(`  ok   ${testCase.label}\n`);
    } else {
      failures += 1;
      process.stdout.write(`  FAIL ${testCase.label} — nothing refused with ${JSON.stringify(testCase.expect)}\n`);
    }
  }

  // The command-line surface, exercised the same way: written to disk, read
  // back through the same argument handling the deploy gate uses.
  const dir = mkdtempSync(join(tmpdir(), 'viewer-assert-'));
  const docs = conformingDocuments();
  const files = {
    stacks: join(dir, 'stacks.json'),
    distribution: join(dir, 'distribution.json'),
    alarms: join(dir, 'alarms.json'),
  };
  writeFileSync(files.stacks, JSON.stringify(docs.stacks));
  writeFileSync(files.distribution, JSON.stringify(docs.distribution));
  writeFileSync(files.alarms, JSON.stringify(docs.alarms));

  const readBack = stackOutputs(readJson(files.stacks)).get('DistributionId');
  if (readBack === 'EXAMPLEDISTID') {
    process.stdout.write('  ok   a stack output is read back off disk\n');
  } else {
    failures += 1;
    process.stdout.write(`  FAIL a stack output read back as ${JSON.stringify(readBack)}\n`);
  }

  if (failures === 0) {
    process.stdout.write(`assert-distribution self-test — PASS (${cases.length + missing.length + 2} case(s))\n`);
    return 0;
  }
  process.stdout.write(`assert-distribution self-test — FAIL (${failures} case(s))\n`);
  return 1;
}

/**
 * @returns {number} process exit code
 */
function main() {
  const mode = process.argv[2];

  if (mode === '--self-test') {
    return selfTest();
  }

  if (mode === '--read-output') {
    const file = process.argv[3];
    const key = process.argv[4];
    if (file === undefined || key === undefined) {
      cannotRun('usage: --read-output <stacks.json> <OutputKey>');
    }
    const value = stackOutputs(readJson(file)).get(key);
    if (value === undefined || value === '') {
      cannotRun(`the stack carries no ${key} output`);
    }
    process.stdout.write(value);
    return 0;
  }

  if (mode === '--assert') {
    const stacksFile = process.argv[3];
    const distributionFile = process.argv[4];
    const alarmsFile = process.argv[5];
    if (stacksFile === undefined || distributionFile === undefined || alarmsFile === undefined) {
      cannotRun('usage: --assert <stacks.json> <distribution.json> <alarms.json>');
    }

    /** @type {string | null} */
    let expectedAlarmAction = null;
    /** @type {number | null} */
    let expectedThreshold = null;

    const rest = process.argv.slice(6);
    let index = 0;
    while (index < rest.length) {
      const flag = rest[index];
      const value = rest[index + 1];
      if (value === undefined) {
        cannotRun(`${flag} needs a value`);
      }
      if (flag === '--expected-alarm-action') {
        expectedAlarmAction = value;
      } else if (flag === '--expected-threshold') {
        const parsed = Number(value);
        if (!Number.isFinite(parsed)) {
          cannotRun(`--expected-threshold must be a number, and it was ${JSON.stringify(value)}`);
        }
        expectedThreshold = parsed;
      } else {
        cannotRun(`unknown argument: ${flag}`);
      }
      index += 2;
    }

    const refusals = assertDistribution({
      stacks: readJson(stacksFile),
      distribution: readJson(distributionFile),
      alarms: readJson(alarmsFile),
      expectedAlarmAction,
      expectedThreshold,
    });

    if (refusals.length === 0) {
      process.stdout.write('assert-distribution — PASS: the built distribution is the one the template describes\n');
      return 0;
    }
    process.stdout.write(`assert-distribution — FAIL — ${refusals.length} refusal(s):\n\n`);
    for (const line of refusals) {
      process.stdout.write(`  ${line}\n`);
    }
    return 1;
  }

  return cannotRun('usage: --read-output | --assert | --self-test');
}

process.exit(main());
