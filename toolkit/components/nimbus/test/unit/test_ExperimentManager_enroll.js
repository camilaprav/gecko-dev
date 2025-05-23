"use strict";

const { Sampling } = ChromeUtils.importESModule(
  "resource://gre/modules/components-utils/Sampling.sys.mjs"
);

const { ClientID } = ChromeUtils.importESModule(
  "resource://gre/modules/ClientID.sys.mjs"
);
const { ClientEnvironment } = ChromeUtils.importESModule(
  "resource://normandy/lib/ClientEnvironment.sys.mjs"
);
const { cleanupStorePrefCache } = ExperimentFakes;

const { ExperimentStore } = ChromeUtils.importESModule(
  "resource://nimbus/lib/ExperimentStore.sys.mjs"
);
const { NimbusTelemetry } = ChromeUtils.importESModule(
  "resource://nimbus/lib/Telemetry.sys.mjs"
);
const { TelemetryEnvironment } = ChromeUtils.importESModule(
  "resource://gre/modules/TelemetryEnvironment.sys.mjs"
);
const { TelemetryEvents } = ChromeUtils.importESModule(
  "resource://normandy/lib/TelemetryEvents.sys.mjs"
);
const { RemoteSettingsExperimentLoader } = ChromeUtils.importESModule(
  "resource://nimbus/lib/RemoteSettingsExperimentLoader.sys.mjs"
);

const { SYNC_DATA_PREF_BRANCH, SYNC_DEFAULTS_PREF_BRANCH } = ExperimentStore;

/**
 * FOG requires a little setup in order to test it
 */
add_setup(function test_setup() {
  // FOG needs a profile directory to put its data in.
  do_get_profile();

  // FOG needs to be initialized in order for data to flow.
  Services.fog.initializeFOG();
});

/**
 * The normal case: Enrollment of a new experiment
 */
add_task(async function test_add_to_store() {
  const manager = ExperimentFakes.manager();
  const recipe = ExperimentFakes.recipe("foo");
  await manager.onStartup();

  await manager.enroll(recipe, "test_add_to_store");
  const experiment = manager.store.get("foo");

  Assert.ok(experiment, "should add an experiment with slug foo");
  Assert.ok(
    recipe.branches.includes(experiment.branch),
    "should choose a branch from the recipe.branches"
  );
  Assert.equal(experiment.active, true, "should set .active = true");

  manager.unenroll("foo", "test-cleanup");

  assertEmptyStore(manager.store);
});

add_task(async function test_add_rollout_to_store() {
  const manager = ExperimentFakes.manager();
  const recipe = {
    ...ExperimentFakes.recipe("rollout-slug"),
    branches: [ExperimentFakes.rollout("rollout").branch],
    isRollout: true,
    active: true,
    bucketConfig: {
      namespace: "nimbus-test-utils",
      randomizationUnit: "normandy_id",
      start: 0,
      count: 1000,
      total: 1000,
    },
  };

  await manager.onStartup();

  await manager.enroll(recipe, "test_add_rollout_to_store");
  const experiment = manager.store.get("rollout-slug");

  Assert.ok(experiment, `Should add an experiment with slug ${recipe.slug}`);
  Assert.ok(
    recipe.branches.includes(experiment.branch),
    "should choose a branch from the recipe.branches"
  );
  Assert.equal(experiment.isRollout, true, "should have .isRollout");

  manager.unenroll("rollout-slug", "test-cleanup");

  assertEmptyStore(manager.store);
});

/**
 * Tests the logic arms (if/else) when enrolling an opt-in recipe
 */
add_task(async function test_enroll_optin_recipe_branch_selection() {
  const sandbox = sinon.createSandbox();
  const manager = ExperimentFakes.manager();

  // stubbing this to return true since we don't want to actually enroll
  // just assert on the call
  let enrollStub = sandbox.stub(manager, "_enroll").returns(true);

  await manager.onStartup();

  const optInRecipe = ExperimentFakes.recipe("opt-in-recipe", {
    isFirefoxLabsOptIn: true,
    branches: [
      {
        slug: "opt-in-recipe-branch-slug",
        ratio: 1,
        features: [{ featureId: "optin", value: {} }],
      },
    ],
  });

  // Call with missing optInRecipeBranchSlug argument
  await Assert.rejects(
    manager.enroll(optInRecipe, "test"),
    /Branch slug not provided for Firefox Labs opt in recipe: "opt-in-recipe"/,
    "Should not enroll an opt-in recipe with missing optInBranchSlug"
  );

  // Call with incorrect optInRecipeBranchSlug for the optin recipe
  await Assert.rejects(
    manager.enroll(optInRecipe, "test", { branchSlug: "invalid-slug" }),
    /Invalid branch slug provided for Firefox Labs opt in recipe: "opt-in-recipe"/,
    "Should not enroll an opt-in recipe with invalid branch slug"
  );

  // Call with the correct branch slug
  await manager.enroll(optInRecipe, "test", {
    branchSlug: optInRecipe.branches[0].slug,
  });
  Assert.ok(
    enrollStub.calledOnceWith(optInRecipe, optInRecipe.branches[0], "test"),
    "should call ._enroll() with the correct arguments"
  );

  assertEmptyStore(manager.store);
});

add_task(async function test_setExperimentActive_recordEnrollment_called() {
  const manager = ExperimentFakes.manager();
  const sandbox = sinon.createSandbox();
  sandbox.spy(NimbusTelemetry, "setExperimentActive");
  sandbox.spy(NimbusTelemetry, "recordEnrollment");

  // Clear any pre-existing data in Glean
  Services.fog.testResetFOG();

  await manager.onStartup();

  // Ensure there is no experiment active with the id in FOG
  Assert.equal(
    undefined,
    Services.fog.testGetExperimentData("foo"),
    "no active experiment exists before enrollment"
  );

  // Check that there aren't any Glean enrollment events yet
  var enrollmentEvents = Glean.nimbusEvents.enrollment.testGetValue("events");
  Assert.equal(
    undefined,
    enrollmentEvents,
    "no Glean enrollment events before enrollment"
  );

  await manager.enroll(
    ExperimentFakes.recipe("foo"),
    "test_setExperimentActive_sendEnrollmentTelemetry_called"
  );
  const experiment = manager.store.get("foo");

  Assert.equal(
    NimbusTelemetry.setExperimentActive.calledWith(experiment),
    true,
    "should call setExperimentActive after an enrollment"
  );

  Assert.equal(
    NimbusTelemetry.recordEnrollment.calledWith(experiment),
    true,
    "should call recordEnrollment after an enrollment"
  );

  // Test Glean experiment API interaction
  Assert.notEqual(
    undefined,
    Services.fog.testGetExperimentData(experiment.slug),
    "Glean.setExperimentActive called with `foo` feature"
  );

  // Check that the Glean enrollment event was recorded.
  enrollmentEvents = Glean.nimbusEvents.enrollment.testGetValue("events");
  // We expect only one event
  Assert.equal(1, enrollmentEvents.length);
  // And that one event matches the expected enrolled experiment
  Assert.equal(
    experiment.slug,
    enrollmentEvents[0].extra.experiment,
    "Glean.nimbusEvents.enrollment recorded with correct experiment slug"
  );
  Assert.equal(
    experiment.branch.slug,
    enrollmentEvents[0].extra.branch,
    "Glean.nimbusEvents.enrollment recorded with correct branch slug"
  );
  Assert.equal(
    experiment.experimentType,
    enrollmentEvents[0].extra.experiment_type,
    "Glean.nimbusEvents.enrollment recorded with correct experiment type"
  );

  manager.unenroll("foo", "test-cleanup");

  assertEmptyStore(manager.store);
  sandbox.restore();
});

add_task(async function test_setRolloutActive_recordEnrollment_called() {
  const manager = ExperimentFakes.manager();
  const sandbox = sinon.createSandbox();
  const rolloutRecipe = {
    ...ExperimentFakes.recipe("rollout"),
    branches: [ExperimentFakes.rollout("rollout").branch],
    isRollout: true,
  };
  sandbox.spy(TelemetryEnvironment, "setExperimentActive");
  sandbox.spy(TelemetryEvents, "sendEvent");
  sandbox.spy(NimbusTelemetry, "setExperimentActive");
  sandbox.spy(NimbusTelemetry, "recordEnrollment");

  // Clear any pre-existing data in Glean
  Services.fog.testResetFOG();

  await manager.onStartup();

  // Test Glean experiment API interaction
  Assert.equal(
    undefined,
    Services.fog.testGetExperimentData("rollout"),
    "no rollout active before enrollment"
  );

  // Check that there aren't any Glean enrollment events yet
  var enrollmentEvents = Glean.nimbusEvents.enrollment.testGetValue("events");
  Assert.equal(
    undefined,
    enrollmentEvents,
    "no Glean enrollment events before enrollment"
  );

  let result = await manager.enroll(rolloutRecipe, "test");

  const enrollment = manager.store.get("rollout");

  Assert.ok(!!result && !!enrollment, "Enrollment was successful");

  Assert.ok(
    TelemetryEnvironment.setExperimentActive.called,
    "should call setExperimentActive"
  );
  Assert.ok(
    NimbusTelemetry.setExperimentActive.calledWith(enrollment),
    "Should call setExperimentActive with the rollout"
  );
  Assert.equal(
    NimbusTelemetry.setExperimentActive.firstCall.args[0].experimentType,
    "rollout",
    "Should have the correct experimentType"
  );
  Assert.equal(
    NimbusTelemetry.recordEnrollment.calledWith(enrollment),
    true,
    "should call sendEnrollmentTelemetry after an enrollment"
  );
  Assert.ok(
    TelemetryEvents.sendEvent.calledOnce,
    "Should send out enrollment telemetry"
  );
  Assert.ok(
    TelemetryEvents.sendEvent.calledWith(
      "enroll",
      sinon.match.string,
      enrollment.slug,
      {
        experimentType: "rollout",
        branch: enrollment.branch.slug,
      }
    ),
    "Should send telemetry with expected values"
  );

  // Test Glean experiment API interaction
  Assert.equal(
    enrollment.branch.slug,
    Services.fog.testGetExperimentData(enrollment.slug).branch,
    "Glean.setExperimentActive called with expected values"
  );

  // Check that the Glean enrollment event was recorded.
  enrollmentEvents = Glean.nimbusEvents.enrollment.testGetValue("events");
  // We expect only one event
  Assert.equal(1, enrollmentEvents.length);
  // And that one event matches the expected enrolled experiment
  Assert.equal(
    enrollment.slug,
    enrollmentEvents[0].extra.experiment,
    "Glean.nimbusEvents.enrollment recorded with correct experiment slug"
  );
  Assert.equal(
    enrollment.branch.slug,
    enrollmentEvents[0].extra.branch,
    "Glean.nimbusEvents.enrollment recorded with correct branch slug"
  );
  Assert.equal(
    enrollment.experimentType,
    enrollmentEvents[0].extra.experiment_type,
    "Glean.nimbusEvents.enrollment recorded with correct experiment type"
  );

  manager.unenroll("rollout", "test-cleanup");

  assertEmptyStore(manager.store);
  sandbox.restore();
});

// /**
//  * Failure cases:
//  * - slug conflict
//  * - group conflict
//  */

add_task(async function test_failure_name_conflict() {
  const manager = ExperimentFakes.manager();
  const sandbox = sinon.createSandbox();
  sandbox.spy(NimbusTelemetry, "recordEnrollmentFailure");

  // Clear any pre-existing data in Glean
  Services.fog.testResetFOG();

  await manager.onStartup();

  // Check that there aren't any Glean enroll_failed events yet
  var failureEvents = Glean.nimbusEvents.enrollFailed.testGetValue("events");
  Assert.equal(
    undefined,
    failureEvents,
    "no Glean enroll_failed events before failure"
  );

  // simulate adding a previouly enrolled experiment
  await manager.store.addEnrollment(ExperimentFakes.experiment("foo"));

  await Assert.rejects(
    manager.enroll(ExperimentFakes.recipe("foo"), "test_failure_name_conflict"),
    /An experiment with the slug "foo" already exists/,
    "should throw if a conflicting experiment exists"
  );

  Assert.equal(
    NimbusTelemetry.recordEnrollmentFailure.calledWith("foo", "name-conflict"),
    true,
    "should send failure telemetry if a conflicting experiment exists"
  );

  // Check that the Glean enrollment event was recorded.
  failureEvents = Glean.nimbusEvents.enrollFailed.testGetValue("events");
  // We expect only one event
  Assert.equal(1, failureEvents.length);
  // And that one event matches the expected enrolled experiment
  Assert.equal(
    "foo",
    failureEvents[0].extra.experiment,
    "Glean.nimbusEvents.enroll_failed recorded with correct experiment slug"
  );
  Assert.equal(
    "name-conflict",
    failureEvents[0].extra.reason,
    "Glean.nimbusEvents.enroll_failed recorded with correct reason"
  );

  manager.unenroll("foo", "test-cleanup");

  assertEmptyStore(manager.store);
  sandbox.restore();
});

add_task(async function test_failure_group_conflict() {
  const manager = ExperimentFakes.manager();
  const sandbox = sinon.createSandbox();
  sandbox.spy(NimbusTelemetry, "recordEnrollmentFailure");

  // Clear any pre-existing data in Glean
  Services.fog.testResetFOG();

  await manager.onStartup();

  // Check that there aren't any Glean enroll_failed events yet
  var failureEvents = Glean.nimbusEvents.enrollFailed.testGetValue("events");
  Assert.equal(
    undefined,
    failureEvents,
    "no Glean enroll_failed events before failure"
  );

  // Two conflicting branches that both have the group "pink"
  // These should not be allowed to exist simultaneously.
  const existingBranch = {
    slug: "treatment",
    ratio: 1,
    features: [{ featureId: "pink", value: {} }],
  };
  const newBranch = {
    slug: "treatment",
    ratio: 1,
    features: [{ featureId: "pink", value: {} }],
  };

  // simulate adding an experiment with a conflicting group "pink"
  await manager.store.addEnrollment(
    ExperimentFakes.experiment("foo", {
      branch: existingBranch,
    })
  );

  // ensure .enroll chooses the special branch with the conflict
  sandbox.stub(manager, "chooseBranch").returns(newBranch);
  Assert.equal(
    await manager.enroll(
      ExperimentFakes.recipe("bar", { branches: [newBranch] }),
      "test_failure_group_conflict"
    ),
    null,
    "should not enroll if there is a feature conflict"
  );

  Assert.equal(
    NimbusTelemetry.recordEnrollmentFailure.calledWith(
      "bar",
      "feature-conflict"
    ),
    true,
    "should send failure telemetry if a feature conflict exists"
  );

  // Check that the Glean enroll_failed event was recorded.
  failureEvents = Glean.nimbusEvents.enrollFailed.testGetValue("events");
  // We expect only one event
  Assert.equal(1, failureEvents.length);
  // And that event matches the expected experiment and reason
  Assert.equal(
    "bar",
    failureEvents[0].extra.experiment,
    "Glean.nimbusEvents.enroll_failed recorded with correct experiment slug"
  );
  Assert.equal(
    "feature-conflict",
    failureEvents[0].extra.reason,
    "Glean.nimbusEvents.enroll_failed recorded with correct reason"
  );

  manager.unenroll("foo", "test-cleanup");

  assertEmptyStore(manager.store);
  sandbox.restore();
});

add_task(async function test_rollout_failure_group_conflict() {
  const manager = ExperimentFakes.manager();
  const sandbox = sinon.createSandbox();
  const recipe = {
    ...ExperimentFakes.recipe("rollout-recipe"),
    isRollout: true,
  };
  const conflictingRecipe = {
    ...recipe,
    slug: "conflicting-rollout-recipe",
  };
  sandbox.spy(NimbusTelemetry, "recordEnrollmentFailure");

  // Clear any pre-existing data in Glean
  Services.fog.testResetFOG();

  await manager.onStartup();

  // Check that there aren't any Glean enroll_failed events yet
  var failureEvents = Glean.nimbusEvents.enrollFailed.testGetValue("events");
  Assert.equal(
    undefined,
    failureEvents,
    "no Glean enroll_failed events before failure"
  );

  await manager.enroll(recipe);

  Assert.equal(
    await manager.enroll(
      conflictingRecipe,
      "test_rollout_failure_group_conflict"
    ),
    null,
    "should not enroll if there is a feature conflict"
  );

  Assert.ok(
    NimbusTelemetry.recordEnrollmentFailure.calledWith(
      conflictingRecipe.slug,
      "feature-conflict"
    ),
    "should send failure telemetry if a feature conflict exists"
  );

  // Check that the Glean enroll_failed event was recorded.
  failureEvents = Glean.nimbusEvents.enrollFailed.testGetValue("events");
  // We expect only one event
  Assert.equal(1, failureEvents.length);
  // And that event matches the expected experiment and reason
  Assert.equal(
    conflictingRecipe.slug,
    failureEvents[0].extra.experiment,
    "Glean.nimbusEvents.enroll_failed recorded with correct experiment slug"
  );
  Assert.equal(
    "feature-conflict",
    failureEvents[0].extra.reason,
    "Glean.nimbusEvents.enroll_failed recorded with correct reason"
  );

  manager.unenroll("rollout-recipe", "test-cleanup");

  assertEmptyStore(manager.store);
  sandbox.restore();
});

add_task(async function test_rollout_experiment_no_conflict() {
  const manager = ExperimentFakes.manager();
  const sandbox = sinon.createSandbox();
  const experiment = ExperimentFakes.recipe("experiment");
  const rollout = ExperimentFakes.recipe("rollout", { isRollout: true });

  sandbox.spy(NimbusTelemetry, "recordEnrollmentFailure");

  // Clear any pre-existing data in Glean
  Services.fog.testResetFOG();

  await manager.onStartup();

  // Check that there aren't any Glean enroll_failed events yet
  var failureEvents = Glean.nimbusEvents.enrollFailed.testGetValue("events");
  Assert.equal(
    undefined,
    failureEvents,
    "no Glean enroll_failed events before failure"
  );

  await ExperimentFakes.enrollmentHelper(experiment, {
    manager,
  });
  await ExperimentFakes.enrollmentHelper(rollout, {
    manager,
  });

  Assert.ok(
    manager.store.get(experiment.slug).active,
    "Enrolled in the experiment for the feature"
  );

  Assert.ok(
    manager.store.get(rollout.slug).active,
    "Enrolled in the rollout for the feature"
  );

  Assert.ok(
    NimbusTelemetry.recordEnrollmentFailure.notCalled,
    "Should send failure telemetry if a feature conflict exists"
  );

  // Check that there aren't any Glean enroll_failed events
  failureEvents = Glean.nimbusEvents.enrollFailed.testGetValue("events");
  Assert.equal(
    undefined,
    failureEvents,
    "no Glean enroll_failed events before failure"
  );

  await ExperimentFakes.cleanupAll([experiment.slug, rollout.slug], {
    manager,
  });

  assertEmptyStore(manager.store);
  sandbox.restore();
});

add_task(async function test_sampling_check() {
  const manager = ExperimentFakes.manager();
  let recipe = ExperimentFakes.recipe("foo", { bucketConfig: null });
  const sandbox = sinon.createSandbox();
  sandbox.stub(Sampling, "bucketSample").resolves(true);
  sandbox.replaceGetter(ClientEnvironment, "userId", () => 42);

  Assert.ok(
    !(await manager.isInBucketAllocation(recipe.bucketConfig)),
    "fails for no bucket config"
  );

  recipe = ExperimentFakes.recipe("foo2", {
    bucketConfig: { randomizationUnit: "foo" },
  });

  Assert.ok(
    !(await manager.isInBucketAllocation(recipe.bucketConfig)),
    "fails for unknown randomizationUnit"
  );

  recipe = ExperimentFakes.recipe("foo3");

  const result = await manager.isInBucketAllocation(recipe.bucketConfig);

  Assert.equal(
    Sampling.bucketSample.callCount,
    1,
    "it should call bucketSample"
  );
  Assert.ok(result, "result should be true");
  const { args } = Sampling.bucketSample.firstCall;
  Assert.equal(args[0][0], 42, "called with expected randomization id");
  Assert.equal(
    args[0][1],
    recipe.bucketConfig.namespace,
    "called with expected namespace"
  );
  Assert.equal(
    args[1],
    recipe.bucketConfig.start,
    "called with expected start"
  );
  Assert.equal(
    args[2],
    recipe.bucketConfig.count,
    "called with expected count"
  );
  Assert.equal(
    args[3],
    recipe.bucketConfig.total,
    "called with expected total"
  );

  assertEmptyStore(manager.store);

  sandbox.restore();
});

add_task(async function enroll_in_reference_aw_experiment() {
  cleanupStorePrefCache();

  let dir = Services.dirsvc.get("CurWorkD", Ci.nsIFile).path;
  let src = PathUtils.join(
    dir,
    "reference_aboutwelcome_experiment_content.json"
  );
  const content = await IOUtils.readJSON(src);
  // Create two dummy branches with the content from disk
  const branches = ["treatment-a", "treatment-b"].map(slug => ({
    slug,
    ratio: 1,
    features: [
      { value: { ...content, enabled: true }, featureId: "aboutwelcome" },
    ],
  }));
  let recipe = ExperimentFakes.recipe("reference-aw", { branches });
  // Ensure we get enrolled
  recipe.bucketConfig.count = recipe.bucketConfig.total;

  const manager = ExperimentFakes.manager();
  await manager.onStartup();
  await manager.enroll(recipe, "enroll_in_reference_aw_experiment");

  Assert.ok(manager.store.get("reference-aw"), "Successful onboarding");
  let prefValue = Services.prefs.getStringPref(
    `${SYNC_DATA_PREF_BRANCH}aboutwelcome`
  );
  Assert.ok(
    prefValue,
    "aboutwelcome experiment enrollment should be stored to prefs"
  );
  // In case some regression causes us to store a significant amount of data
  // in prefs.
  Assert.ok(prefValue.length < 3498, "Make sure we don't bloat the prefs");

  manager.unenroll(recipe.slug, "enroll_in_reference_aw_experiment:cleanup");

  assertEmptyStore(manager.store);
});

add_task(async function test_forceEnroll_cleanup() {
  const manager = ExperimentFakes.manager();
  const sandbox = sinon.createSandbox();
  let unenrollStub = sandbox.spy(manager, "unenroll");
  let existingRecipe = ExperimentFakes.recipe("foo", {
    branches: [
      {
        slug: "treatment",
        ratio: 1,
        features: [{ featureId: "force-enrollment", value: {} }],
      },
    ],
  });
  let forcedRecipe = ExperimentFakes.recipe("bar", {
    branches: [
      {
        slug: "treatment",
        ratio: 1,
        features: [{ featureId: "force-enrollment", value: {} }],
      },
    ],
  });

  await manager.onStartup();
  await manager.enroll(existingRecipe, "test_forceEnroll_cleanup");

  sandbox.spy(NimbusTelemetry, "setExperimentActive");
  manager.forceEnroll(forcedRecipe, forcedRecipe.branches[0]);

  Assert.ok(unenrollStub.called, "Unenrolled from existing experiment");
  Assert.equal(
    unenrollStub.firstCall.args[0],
    existingRecipe.slug,
    "Called with existing recipe slug"
  );
  Assert.ok(
    NimbusTelemetry.setExperimentActive.calledOnce,
    "Activated forced experiment"
  );
  Assert.equal(
    NimbusTelemetry.setExperimentActive.firstCall.args[0].slug,
    `optin-${forcedRecipe.slug}`,
    "Called with forced experiment slug"
  );
  Assert.equal(
    manager.store.getExperimentForFeature("force-enrollment").slug,
    `optin-${forcedRecipe.slug}`,
    "Enrolled in forced experiment"
  );

  manager.unenroll(`optin-${forcedRecipe.slug}`, "test-cleanup");

  assertEmptyStore(manager.store);

  sandbox.restore();
});

add_task(async function test_rollout_unenroll_conflict() {
  const manager = ExperimentFakes.manager();
  const sandbox = sinon.createSandbox();
  let unenrollStub = sandbox.stub(manager, "unenroll").returns(true);
  let enrollStub = sandbox.stub(manager, "_enroll").returns(true);
  let rollout = ExperimentFakes.rollout("rollout_conflict");

  // We want to force a conflict
  sandbox.stub(manager.store, "getRolloutForFeature").returns(rollout);

  manager.forceEnroll(rollout, rollout.branch);

  Assert.ok(unenrollStub.calledOnce, "Should unenroll the conflicting rollout");
  Assert.ok(
    unenrollStub.calledWith(rollout.slug, "force-enrollment"),
    "Should call with expected slug"
  );
  Assert.ok(enrollStub.calledOnce, "Should call enroll as expected");

  manager.unenroll(rollout.slug, "test-cleanup");
  assertEmptyStore(manager.store);

  sandbox.restore();
});

add_task(async function test_forceEnroll() {
  const experiment1 = ExperimentFakes.recipe("experiment-1");
  const experiment2 = ExperimentFakes.recipe("experiment-2");
  const rollout1 = ExperimentFakes.recipe("rollout-1", { isRollout: true });
  const rollout2 = ExperimentFakes.recipe("rollout-2", { isRollout: true });

  const TEST_CASES = [
    {
      enroll: [experiment1, rollout1],
      expected: [experiment1, rollout1],
    },
    {
      enroll: [rollout1, experiment1],
      expected: [experiment1, rollout1],
    },
    {
      enroll: [experiment1, experiment2],
      expected: [experiment2],
    },
    {
      enroll: [rollout1, rollout2],
      expected: [rollout2],
    },
    {
      enroll: [experiment1, rollout1, rollout2, experiment2],
      expected: [experiment2, rollout2],
    },
  ];

  const loader = ExperimentFakes.rsLoader();
  const manager = loader.manager;

  sinon
    .stub(loader.remoteSettingsClients.experiments, "get")
    .resolves([experiment1, experiment2, rollout1, rollout2]);

  await manager.onStartup();
  await loader.enable();

  for (const { enroll, expected } of TEST_CASES) {
    for (const recipe of enroll) {
      await manager.forceEnroll(recipe, recipe.branches[0]);
    }

    const activeSlugs = manager.store
      .getAll()
      .filter(enrollment => enrollment.active)
      .map(r => r.slug);

    Assert.equal(
      activeSlugs.length,
      expected.length,
      `Should be enrolled in ${expected.length} experiments and rollouts`
    );

    for (const { slug, isRollout } of expected) {
      Assert.ok(
        activeSlugs.includes(`optin-${slug}`),
        `Should be enrolled in ${
          isRollout ? "rollout" : "experiment"
        } with slug optin-${slug}`
      );
    }

    for (const { slug } of expected) {
      manager.unenroll(`optin-${slug}`);
    }
  }

  assertEmptyStore(manager.store);
});

add_task(async function test_featureIds_is_stored() {
  Services.prefs.setStringPref("messaging-system.log", "all");
  const recipe = ExperimentFakes.recipe("featureIds");
  // Ensure we get enrolled
  recipe.bucketConfig.count = recipe.bucketConfig.total;
  const store = ExperimentFakes.store();
  const manager = ExperimentFakes.manager(store);

  await manager.onStartup();

  const doExperimentCleanup = await ExperimentFakes.enrollmentHelper(recipe, {
    manager,
  });

  Assert.ok(manager.store.addEnrollment.calledOnce, "experiment is stored");
  let [enrollment] = manager.store.addEnrollment.firstCall.args;
  Assert.ok("featureIds" in enrollment, "featureIds is stored");
  Assert.deepEqual(
    enrollment.featureIds,
    ["testFeature"],
    "Has expected value"
  );

  doExperimentCleanup();

  assertEmptyStore(manager.store);
});

add_task(async function experiment_and_rollout_enroll_and_cleanup() {
  let store = ExperimentFakes.store();
  const manager = ExperimentFakes.manager(store);

  await manager.onStartup();

  let doRolloutCleanup = await ExperimentFakes.enrollWithFeatureConfig(
    {
      featureId: "aboutwelcome",
      value: { enabled: true },
    },
    {
      manager,
      isRollout: true,
    }
  );

  let doExperimentCleanup = await ExperimentFakes.enrollWithFeatureConfig(
    {
      featureId: "aboutwelcome",
      value: { enabled: true },
    },
    { manager }
  );

  Assert.ok(
    Services.prefs.getBoolPref(`${SYNC_DATA_PREF_BRANCH}aboutwelcome.enabled`)
  );
  Assert.ok(
    Services.prefs.getBoolPref(
      `${SYNC_DEFAULTS_PREF_BRANCH}aboutwelcome.enabled`
    )
  );

  doExperimentCleanup();

  Assert.ok(
    !Services.prefs.getBoolPref(
      `${SYNC_DATA_PREF_BRANCH}aboutwelcome.enabled`,
      false
    )
  );
  Assert.ok(
    Services.prefs.getBoolPref(
      `${SYNC_DEFAULTS_PREF_BRANCH}aboutwelcome.enabled`
    )
  );

  doRolloutCleanup();

  Assert.ok(
    !Services.prefs.getBoolPref(
      `${SYNC_DATA_PREF_BRANCH}aboutwelcome.enabled`,
      false
    )
  );
  Assert.ok(
    !Services.prefs.getBoolPref(
      `${SYNC_DEFAULTS_PREF_BRANCH}aboutwelcome.enabled`,
      false
    )
  );

  assertEmptyStore(manager.store);
});

add_task(async function test_reEnroll() {
  const store = ExperimentFakes.store();
  const manager = ExperimentFakes.manager(store);

  await manager.onStartup();
  await manager.store.ready();

  const experiment = ExperimentFakes.recipe("experiment");
  experiment.bucketConfig = {
    ...experiment.bucketConfig,
    start: 0,
    count: 1000,
    total: 1000,
  };
  const rollout = ExperimentFakes.recipe("rollout", { isRollout: true });
  rollout.bucketConfig = {
    ...rollout.bucketConfig,
    start: 0,
    count: 1000,
    total: 1000,
  };

  await manager.enroll(experiment, "test");
  Assert.equal(
    manager.store.getExperimentForFeature("testFeature")?.slug,
    experiment.slug,
    "Should enroll in experiment"
  );

  await manager.enroll(rollout, "test");
  Assert.equal(
    manager.store.getRolloutForFeature("testFeature")?.slug,
    rollout.slug,
    "Should enroll in rollout"
  );

  manager.unenroll(experiment.slug);
  Assert.ok(
    !manager.store.getExperimentForFeature("testFeature"),
    "Should unenroll from experiment"
  );

  manager.unenroll(rollout.slug);
  Assert.ok(
    !manager.store.getRolloutForFeature("testFeature"),
    "Should unenroll from rollout"
  );

  await Assert.rejects(
    manager.enroll(experiment, "test", { reenroll: true }),
    /An experiment with the slug "experiment" already exists/,
    "Should not re-enroll in experiment"
  );

  await manager.enroll(rollout, "test", { reenroll: true });
  Assert.equal(
    manager.store.getRolloutForFeature("testFeature")?.slug,
    rollout.slug,
    "Should re-enroll in rollout"
  );

  manager.unenroll(rollout.slug);
  assertEmptyStore(store);
});

add_task(async function test_randomizationUnit() {
  const ENROLL = "cedc1378-b806-4664-8c3e-2090f2f46e00";
  const NOT_ENROLL = "b502506a-416c-40ea-9f96-c6feaf451470";

  const normandyIdBucketing = ExperimentFakes.recipe.bucketConfig;
  const groupIdBucketing = {
    ...ExperimentFakes.recipe.bucketConfig,
    randomizationUnit: "group_id",
  };

  Services.prefs.setStringPref("app.normandy.user_id", ENROLL);
  await ClientID.setProfileGroupID(NOT_ENROLL);

  const manager = ExperimentFakes.manager();

  Assert.ok(
    await manager.isInBucketAllocation(normandyIdBucketing),
    "in bucketing using normandy_id"
  );
  Assert.ok(
    !(await manager.isInBucketAllocation(groupIdBucketing)),
    "not in bucketing using group_id"
  );

  Services.prefs.setStringPref("app.normandy.user_id", NOT_ENROLL);
  await ClientID.setProfileGroupID(ENROLL);

  Assert.ok(
    !(await manager.isInBucketAllocation(normandyIdBucketing)),
    "not in bucketing using normandy_id"
  );
  Assert.ok(
    await manager.isInBucketAllocation(groupIdBucketing),
    "in bucketing using group_id"
  );
});

add_task(async function test_group_enrollment() {
  // We need multiple instances of manager to simulate multiple profiles
  const store1 = ExperimentFakes.store();
  const manager1 = ExperimentFakes.manager(store1);

  await manager1.onStartup();

  const groupId = "cedc1378-b806-4664-8c3e-2090f2f46e00";
  const clientId1 = "clientid1";
  const clientId2 = "clientid2";
  const branchA = {
    slug: "branchA",
    ratio: 1,
    features: [{ featureId: "pink", value: {} }],
  };
  const branchB = {
    slug: "branchB",
    ratio: 1,
    features: [{ featureId: "pink", value: {} }],
  };
  const recipe = {
    ...ExperimentFakes.recipe("group_enroll"),
    branches: [branchA, branchB],
    isRollout: false,
    active: true,
    bucketConfig: {
      namespace: "nimbus-test-utils",
      randomizationUnit: "group_id",
      start: 0,
      count: 1000,
      total: 1000,
    },
  };

  // set the group ID
  await ClientID.setProfileGroupID(groupId);
  // enroll the first clientID in the experiment
  Services.prefs.setStringPref("app.normandy.user_id", clientId1);

  await manager1.enroll(recipe, "test_group_enrollment");

  const experiment1 = manager1.store.get("group_enroll");
  let clientId1branch = experiment1.branch;

  // create the second manager && enroll the second clientID
  const store2 = ExperimentFakes.store();
  const manager2 = ExperimentFakes.manager(store2);

  await manager2.onStartup();

  Services.prefs.setStringPref("app.normandy.user_id", clientId2);

  await manager2.enroll(recipe, "test_group_enrollment");

  const experiment2 = manager2.store.get("group_enroll");
  let clientId2branch = experiment2.branch;

  Assert.equal(
    clientId1branch,
    clientId2branch,
    "should have enrolled in the same branch"
  );

  // Cleanup
  manager1.unenroll("group_enroll", "test-cleanup");
  assertEmptyStore(manager1.store);

  manager2.unenroll("group_enroll", "test-cleanup");
  assertEmptyStore(manager2.store);
});

add_task(async function test_getSingleOptInRecipe() {
  const sandbox = sinon.createSandbox();
  const manager = ExperimentFakes.manager();
  const optInRecipes = [
    ExperimentFakes.recipe("opt-in-one", { isFirefoxLabsOptIn: true }),
    ExperimentFakes.recipe("opt-in-two", { isFirefoxLabsOptIn: true }),
  ];

  manager.optInRecipes = optInRecipes;

  sandbox.stub(RemoteSettingsExperimentLoader, "finishedUpdating").resolves();

  Assert.equal(
    await manager.getSingleOptInRecipe(optInRecipes[0].slug),
    optInRecipes[0],
    "should return the correct opt in recipe with the slug opt-in-one"
  );

  Assert.equal(
    await manager.getSingleOptInRecipe("non-existent"),
    undefined,
    "should return undefined if no opt in recipe exists with the slug non-existent"
  );

  await Assert.rejects(
    manager.getSingleOptInRecipe(),
    /Slug required for .getSingleOptInRecipe/,
    "Should throw when .getSingleOptInRecipe is called without a slug argument"
  );

  sandbox.restore();
  assertEmptyStore(manager.store);
});

add_task(async function test_getAllOptInRecipes() {
  const sandbox = sinon.createSandbox();
  const manager = ExperimentFakes.manager();

  const optInRecipesWithTargetMatchingAndBucketing = [
    ExperimentFakes.recipe("opt-in-one", {
      targeting: "true",
      isFirefoxLabsOptIn: true,
      bucketConfig: {
        ...ExperimentFakes.recipe.bucketConfig,
        count: 1000,
      },
    }),
    ExperimentFakes.recipe("opt-in-two", {
      targeting: "true",
      isFirefoxLabsOptIn: true,
      bucketConfig: {
        ...ExperimentFakes.recipe.bucketConfig,
        count: 1000,
      },
    }),
  ];

  const optInRecipesWithTargetMatchingOnly = [
    ExperimentFakes.recipe("opt-in-one", {
      targeting: "true",
      isFirefoxLabsOptIn: true,
      bucketConfig: {},
    }),
    ExperimentFakes.recipe("opt-in-two", {
      targeting: "true",
      isFirefoxLabsOptIn: true,
      bucketConfig: {},
    }),
  ];

  const optInRecipesWithBucketingMatchingOnly = [
    ExperimentFakes.recipe("opt-in-one", {
      targeting: "false",
      isFirefoxLabsOptIn: true,
      bucketConfig: {
        ...ExperimentFakes.recipe.bucketConfig,
        count: 1000,
      },
    }),
    ExperimentFakes.recipe("opt-in-two", {
      targeting: "false",
      isFirefoxLabsOptIn: true,
      bucketConfig: {
        ...ExperimentFakes.recipe.bucketConfig,
        count: 1000,
      },
    }),
  ];

  sandbox.stub(RemoteSettingsExperimentLoader, "finishedUpdating").resolves();

  // Happy path, opt in recipes meet targeting and bucketing criteria.
  manager.optInRecipes = optInRecipesWithTargetMatchingAndBucketing;
  Assert.deepEqual(
    await manager.getAllOptInRecipes(),
    optInRecipesWithTargetMatchingAndBucketing,
    "should return the correct opt in recipes with targeting and bucketing match"
  );

  // Unhappy path, opt in recipes meet only targeting criteria.
  manager.optInRecipes = optInRecipesWithTargetMatchingOnly;
  Assert.deepEqual(
    await manager.getAllOptInRecipes(),
    [],
    "should return an empty array for recipes with a targeting match only"
  );

  // Unhappy path, opt in recipes meet only bucketing criteria.
  manager.optInRecipes = optInRecipesWithBucketingMatchingOnly;
  Assert.deepEqual(
    await manager.getAllOptInRecipes(),
    [],
    "should return an empty array for recipes with a bucketing match only"
  );

  sandbox.restore();
  assertEmptyStore(manager.store);
});
