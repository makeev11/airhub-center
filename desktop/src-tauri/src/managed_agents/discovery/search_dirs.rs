use std::path::{Path, PathBuf};

fn profile_target_dirs(root: &Path) -> [PathBuf; 2] {
    if cfg!(debug_assertions) {
        // `just dev` builds fresh debug sidecars; never prefer stale release output.
        [root.join("target/debug"), root.join("target/release")]
    } else {
        [root.join("target/release"), root.join("target/debug")]
    }
}

pub(super) fn command_search_dirs_for(
    workspace_root: &Path,
    current_dir: Option<&Path>,
    current_exe_dir: Option<&Path>,
    prefer_bundled: bool,
) -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if prefer_bundled {
        dirs.extend(current_exe_dir.map(Path::to_path_buf));
    }
    dirs.extend(profile_target_dirs(workspace_root));
    if let Some(current_dir) = current_dir {
        dirs.extend(profile_target_dirs(current_dir));
    }
    if !prefer_bundled {
        dirs.extend(current_exe_dir.map(Path::to_path_buf));
    }

    dirs.into_iter().fold(Vec::new(), |mut unique, dir| {
        if !unique.contains(&dir) {
            unique.push(dir);
        }
        unique
    })
}
