# This Source Code Form is subject to the terms of the Mozilla Public
# License, v. 2.0. If a copy of the MPL was not distributed with this
# file, You can obtain one at http://mozilla.org/MPL/2.0/.

import logging
import os
import shlex

import taskgraph
from taskgraph.transforms.base import TransformSequence
from taskgraph.util.path import match as match_path

from gecko_taskgraph.util.hg import get_json_automationrelevance

logger = logging.getLogger(__name__)

transforms = TransformSequence()


def get_patterns(job):
    """Get the "run on-changed" file patterns."""
    optimization = job.get("optimization", {})
    if optimization:
        return optimization.copy().popitem()[1]
    return []


def shlex_join(split_command):
    """shlex.join from Python 3.8+"""
    return " ".join(shlex.quote(arg) for arg in split_command)


@transforms.add
def changed_clang_format(config, jobs):
    """
    Transform for clang-format job to set the commandline to only check
    C++ files that were changed in the current push rather than running on
    the entire repository.
    """
    for job in jobs:
        if job.get("name", "") == "clang-format":
            prefix = config.params.get("comm_src_path")
            files_changed = config.params.get("files_changed")

            match_patterns = get_patterns(job)
            changed_files = {file for file in files_changed if file.startswith(prefix)}

            cpp_files = []
            for pattern in match_patterns:
                for path in changed_files:
                    if match_path(path, pattern):
                        cpp_files.append(path)

            # In the event that no C/C++ files were changed in the current push,
            # the commandline will end up being invalid. But, the clang-format
            # job will get dropped by optimization, so it doesn't really matter.
            if cpp_files:
                job["task-context"] = {
                    "from-object": {
                        "changed_files": shlex_join(cpp_files),
                    },
                    "substitution-fields": [
                        "run.command",
                    ],
                }

        yield job


@transforms.add
def set_base_revision_in_tgdiff(config, jobs):
    # Don't attempt to download 'json-automation' locally as the revision may
    # not exist in the repository.
    if not os.environ.get("MOZ_AUTOMATION") or taskgraph.fast:
        yield from jobs
        return

    data = get_json_automationrelevance(
        config.params["comm_head_repository"], config.params["comm_head_rev"]
    )
    for job in jobs:
        if job["name"] != "taskgraph-diff":
            yield job
            continue

        job["task-context"] = {
            "from-object": {
                "base_rev": data["changesets"][0]["parents"][0],
            },
            "substitution-fields": [
                "run.command",
            ],
        }
        yield job
