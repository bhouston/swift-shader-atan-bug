# SwiftShader atan2 contribution notes

Updated October 8, 2026. The bug report and proposed patch have been submitted.

- **Official issue:** [571218887](https://issuetracker.google.com/issues/571218887).
- **Proposed patch:** [Gerrit change 77868](https://swiftshader-review.googlesource.com/c/SwiftShader/+/77868).

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

## Review follow-up

- Check the [Google Individual CLA](https://cla.developers.google.com/about/google-individual) if needed; upstream requires it before landing. Corporate contributions use the [corporate agreement](https://cla.developers.google.com/about/google-corporate).
- Request review from an owner listed in [OWNERS](https://swiftshader.googlesource.com/SwiftShader/+/HEAD/OWNERS).
- Address feedback on [change 77868](https://swiftshader-review.googlesource.com/c/SwiftShader/+/77868). Amend the submitted review commit while keeping its `Change-Id`, then upload the new patch set from your review branch:

  ```sh
  cd ~/Coding/.worktrees/swiftshader-atan2-negative-zero
  git-dedup switch review/atan2-negative-zero
  # Edit, test, and stage the requested changes first.
  git-dedup commit --amend
  git-dedup push origin HEAD:refs/for/master
  ```

The maintainer handles approval and landing. See [Gerrit upload documentation](https://gerrit-review.googlesource.com/Documentation/user-upload.html) for updating an existing review.

## Validation and local checks

On macOS arm64 with the LLVM backend:

- Before the fix: all 8 signed-zero regression variants fail; all 8 nonzero quadrant controls pass.
- After the fix: all 16 arctangent variants and all **155 Vulkan unit tests pass**.
- A direct Reactor probe changes from 6 failures out of 36 cases to zero failures, independently of ANGLE.
- Browser validation before the later WebGPU repro additions: affected Chromium 156 reports **4 failures and 9 passes**; native M3 WebGL/WebGPU reports **13 passes**. Both signs of x have 257 failing negative-zero samples on SwiftShader and zero on native M3.
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

## Review summary

**Title:** Fix atan2 quadrant selection for negative zero

Runtime `atan2(-0, x)` returns π for positive x and zero for negative x. Use the sign bit of y consistently for both quadrant rotations, including negative zero.

Add Vulkan regression tests with runtime buffer inputs covering signed zeros, both signs of x, normal powers of two, and nonzero quadrant controls.

Validation: 8 regression variants fail before the fix; all 16 arctangent variants and all 155 Vulkan unit tests pass afterward on macOS arm64/LLVM.
