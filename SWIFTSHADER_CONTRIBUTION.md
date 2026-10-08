# Submitting the SwiftShader atan2 fix

Prepared October 8, 2026. You will submit the bug report and upstream review yourself; neither has been submitted.

## Prepared branch

- Fork: [bhouston/swiftshader](https://github.com/bhouston/swiftshader).
- Branch: [`fix/atan2-negative-zero`](https://github.com/bhouston/swiftshader/tree/fix/atan2-negative-zero).
- [Review the two-commit diff](https://github.com/bhouston/swiftshader/compare/master...fix/atan2-negative-zero).
- `ee57aa80`: regression tests only; deliberately exposes the existing failure.
- `0b90421e`: sign-bit fix; the regression passes.
- Author: Ben Houston, `neuralsoft@gmail.com`. Both commits include distinct Gerrit `Change-Id` trailers.
- Local worktree: `~/Coding/.worktrees/swiftshader-atan2-negative-zero`.
- Canonical upstream clone: `~/Coding/OpenSource/SwiftShader`.

SwiftShader uses **Gerrit** for upstream review. Its GitHub repository is a mirror, so a GitHub PR alone does not complete the documented contribution process. See the upstream [README](https://swiftshader.googlesource.com/SwiftShader/+/HEAD/README.md) and [contribution requirements](https://swiftshader.googlesource.com/SwiftShader/+/HEAD/CONTRIBUTING.txt).

## Steps for you

1. **Check your CLA.** Sign the [Google Individual CLA](https://cla.developers.google.com/about/google-individual) if needed. Upstream requires it before landing, but permits submitting a review first. Corporate contributions use the [corporate agreement](https://cla.developers.google.com/about/google-corporate).

2. **File the bug.** Use the official [SwiftShader tracker](https://g.co/swiftshaderbugs), component **408190**, and the draft below. Link this repro repository and the fork branch. General tracker searches did not surface an exact duplicate; check the tracker once more before filing.

3. **Authenticate Gerrit uploads.** You already registered `neuralsoft@gmail.com` at [SwiftShader Gerrit](https://swiftshader-review.googlesource.com/). Follow the instructions at [Generate Git credentials](https://swiftshader.googlesource.com/new-password) while signed into the same account. Run those credential instructions locally; keep the generated credentials out of commits and reports. This is the authentication step specified by the upstream README.

4. **Choose the review shape.** My recommendation is one Gerrit change containing the tests and fix together: the test-only commit fails CI by design. The requested two-commit history remains on your fork. To prepare a separate combined review branch:

   ```sh
   cd ~/Coding/.worktrees/swiftshader-atan2-negative-zero
   git-dedup fetch origin
   git-dedup switch -c review/atan2-negative-zero origin/master
   git-dedup merge --squash fix/atan2-negative-zero
   git-dedup commit
   ```

   Use the review draft below as the commit message, and add `Bug: b/ISSUE_NUMBER` after filing the bug. The installed local commit hook generates a new `Change-Id` and calls `git-dedup` internally. A combined review is a workflow recommendation, not an upstream requirement to squash.

5. **Upload the review yourself.** From the branch you want reviewed:

   ```sh
   git-dedup push origin HEAD:refs/for/master
   ```

   From `review/atan2-negative-zero`, this creates one Gerrit change. From `fix/atan2-negative-zero`, it creates two dependent changes. If you choose the latter, explain that the parent is a regression commit and should not land independently. Gerrit creates a separate change for each new commit; see [Gerrit upload documentation](https://gerrit-review.googlesource.com/Documentation/user-upload.html).

6. **Request review.** Add an owner listed in [OWNERS](https://swiftshader.googlesource.com/SwiftShader/+/HEAD/OWNERS), as required by the upstream README. Current primary owners include `syoussefi@google.com`, `geofflang@google.com`, and `ynovikov@google.com`. `sugoi@google.com` (Alexis Hétu) is also listed and has recent history in `ShaderCore.cpp`. Let the project choose the assignee for the bug.

7. **Respond to review and CI.** Address feedback, amend the relevant commit while keeping its `Change-Id`, and push to `refs/for/master` again to update the existing review. The maintainer handles approval and landing.

## Validation and local checks

On macOS arm64 with the LLVM backend:

- Before the fix: all 8 signed-zero regression variants fail; all 8 nonzero quadrant controls pass.
- After the fix: all 16 arctangent variants and all **155 Vulkan unit tests pass**.
- A direct Reactor probe changes from 6 failures out of 36 cases to zero failures, independently of ANGLE.
- Updated browser repro: affected Chromium 156 reports **4 failures and 9 passes**; native M3 WebGL/WebGPU reports **13 passes**. Both signs of x have 257 failing negative-zero samples on SwiftShader and zero on native M3.
- Formatting checked with **clang-format 11.0.1**. Copyright, Go formatting, build-file validation, and source scanning pass. The local presubmit copy used `git-dedup`, omitted the script's unrelated global safe-directory mutation, and explicitly checked both changed C++ files.
- The fix has not been tested with Windows/Subzero or the full dEQP conformance suite.

To build the upstream branch normally:

```sh
cd ~/Coding/.worktrees/swiftshader-atan2-negative-zero
git-dedup submodule update --init third_party/glslang third_party/googletest
cmake -S . -B /tmp/swiftshader-review-build -G Ninja -DCMAKE_BUILD_TYPE=Release -DSWIFTSHADER_BUILD_TESTS=ON -DSWIFTSHADER_WARNINGS_AS_ERRORS=OFF
cmake --build /tmp/swiftshader-review-build --target vk-unittests --parallel 8
cd /tmp/swiftshader-review-build
./vk-unittests --gtest_filter='*Atan2*'
./vk-unittests
```

Upstream's [presubmit script](https://swiftshader.googlesource.com/SwiftShader/+/HEAD/tests/presubmit.sh) and [formatting guidance](https://swiftshader.googlesource.com/SwiftShader/+/HEAD/README.md#Contributing) describe the repository checks. The scripts contain direct `git` calls, so use a local adapted copy to honor your `git-dedup` policy. No build-system or third-party source changes are included in the branch.

## Review / PR draft

**Title:** Fix atan2 quadrant selection for negative zero

Runtime `atan2(-0, x)` returns π for positive x and zero for negative x. Use the sign bit of y consistently for both quadrant rotations, including negative zero.

Add Vulkan regression tests with runtime buffer inputs covering signed zeros, both signs of x, normal powers of two, and nonzero quadrant controls.

Validation: 8 regression variants fail before the fix; all 16 arctangent variants and all 155 Vulkan unit tests pass afterward on macOS arm64/LLVM.

## Bug report draft

**Title:** SwiftShader atan2 selects the wrong quadrant for runtime negative zero

**Observed:** GLSL `atan(y, x)` with runtime `y = -0` returns approximately π when x is positive and zero when x is negative.

**Expected:** Zero for positive x; ±π for negative x. Either sign is accepted for the zero input because GLSL permits interchanging signed zeros.

**Reproduction:** https://github.com/bhouston/swift-shader-atan-bug. Run `npm ci`, `npx playwright install chromium`, then `npm test`. The repository includes minimal shaders and input sweeps for both signs of x.

On M3/Chromium 156, all 257 positive-x and all 257 negative-x negative-zero samples fail. Positive-zero and nonzero controls pass. Native M3 passes all 13 browser tests. The original positive-x issue also reproduces on Windows/Subzero; the expanded negative-x suite and fix have not yet been validated there.

**Cause:** `src/Pipeline/ShaderCore.cpp`, `sw::Atan2`, compares `y < 0` to choose the initial angle but uses y's sign bit to rotate x. Negative zero makes those decisions disagree. Direct Vulkan tests reproduce both errors without ANGLE.

**Affected revisions:** `5b0479bd2d15058aaa9eb490e364f920ff824a8c` (Chrome 154, original issue) and `1e80438d2b93ef36a7c05f8d2b81233bac0e3d16` (Chromium 156, both errors verified on M3).

**Proposed fix:** https://github.com/bhouston/swiftshader/tree/fix/atan2-negative-zero. Replace the floating-point comparison with `CmpLT(As<SIMD::Int>(y), SIMD::Int(0))`; tests and fix are separate commits. All 155 Vulkan tests pass on macOS arm64/LLVM after the fix.
