use super::*;
use std::fs;

#[test]
fn rename_path_renames_file_within_parent_directory() {
    let dir = home_test_dir("rename_file");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let original = dir.join("old.txt");
    let renamed = dir.join("new.txt");
    fs::write(&original, "content").unwrap();

    let result = rename_path(RenamePathRequest {
        path: original.to_string_lossy().to_string(),
        new_name: "new.txt".to_string(),
    });

    assert!(result.is_ok(), "rename should succeed: {:?}", result.err());
    assert!(!original.exists());
    assert_eq!(fs::read_to_string(&renamed).unwrap(), "content");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rename_path_rejects_nested_target_name() {
    let dir = home_test_dir("rename_nested_target");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let original = dir.join("old.txt");
    fs::write(&original, "content").unwrap();

    let result = rename_path(RenamePathRequest {
        path: original.to_string_lossy().to_string(),
        new_name: "../evil.txt".to_string(),
    });

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("single path component"));
    assert!(original.exists());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn rename_path_rejects_existing_target() {
    let dir = home_test_dir("rename_existing_target");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let original = dir.join("old.txt");
    let existing = dir.join("new.txt");
    fs::write(&original, "old").unwrap();
    fs::write(&existing, "existing").unwrap();

    let result = rename_path(RenamePathRequest {
        path: original.to_string_lossy().to_string(),
        new_name: "new.txt".to_string(),
    });

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("target already exists"));
    assert_eq!(fs::read_to_string(&existing).unwrap(), "existing");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn delete_path_removes_file() {
    let dir = home_test_dir("delete_file");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let target = dir.join("delete-me.txt");
    fs::write(&target, "content").unwrap();

    let result = delete_path(DeletePathRequest {
        path: target.to_string_lossy().to_string(),
    });

    assert!(result.is_ok(), "delete should succeed: {:?}", result.err());
    assert!(!target.exists());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn delete_path_removes_directory_tree() {
    let dir = home_test_dir("delete_dir");
    let _ = fs::remove_dir_all(&dir);
    let target = dir.join("folder");
    fs::create_dir_all(target.join("nested")).unwrap();
    fs::write(target.join("nested").join("file.txt"), "content").unwrap();

    let result = delete_path(DeletePathRequest {
        path: target.to_string_lossy().to_string(),
    });

    assert!(result.is_ok(), "delete should succeed: {:?}", result.err());
    assert!(!target.exists());

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn delete_path_rejects_path_outside_home() {
    let result = delete_path(DeletePathRequest {
        path: "/etc/passwd".to_string(),
    });

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("access denied"));
}

#[cfg(unix)]
#[test]
fn delete_path_refuses_symlink_leaf() {
    use std::os::unix::fs::symlink;

    let dir = home_test_dir("delete_symlink_leaf");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let target = dir.join("target.txt");
    let link = dir.join("link.txt");
    fs::write(&target, "content").unwrap();
    symlink(&target, &link).unwrap();

    let result = delete_path(DeletePathRequest {
        path: link.to_string_lossy().to_string(),
    });

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("refusing to mutate symlink"));
    assert!(link.exists());
    assert!(target.exists());

    let _ = fs::remove_dir_all(&dir);
}
