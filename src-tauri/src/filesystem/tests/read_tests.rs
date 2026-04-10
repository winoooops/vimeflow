use super::*;
use std::fs;

#[test]
fn read_file_returns_content() {
    let dir = home_test_dir("read_file");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    fs::write(dir.join("hello.txt"), "hello world").unwrap();

    let result = read_file(ReadFileRequest {
        path: dir.join("hello.txt").to_string_lossy().to_string(),
    });

    assert!(result.is_ok());
    assert_eq!(result.unwrap(), "hello world");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn read_file_rejects_path_outside_home() {
    let result = read_file(ReadFileRequest {
        path: "/etc/passwd".to_string(),
    });
    assert!(result.is_err());
    assert!(result.unwrap_err().contains("access denied"));
}

#[test]
fn read_file_rejects_directory() {
    let dir = home_test_dir("read_file_dir");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let result = read_file(ReadFileRequest {
        path: dir.to_string_lossy().to_string(),
    });

    assert!(result.is_err());
    assert!(result.unwrap_err().contains("not a file"));

    let _ = fs::remove_dir_all(&dir);
}

#[cfg(unix)]
#[test]
fn read_file_refuses_to_follow_symlink_escaping_home() {
    // Mirror of the write_file symlink regression test. If a symlink
    // inside home points outside home and `read_file` follows it,
    // the webview would receive sandbox-escaped contents.
    use std::os::unix::fs::symlink;

    let dir = home_test_dir("read_file_symlink_escape");
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    // Point the symlink at a real file outside home so canonicalize() resolves
    // and the scope check would otherwise accept it if not for O_NOFOLLOW.
    let outside_target = std::env::temp_dir().join(".vimeflow_read_file_symlink_secret.txt");
    fs::write(&outside_target, "SECRET").unwrap();

    let link = dir.join("innocent_name.txt");
    symlink(&outside_target, &link).unwrap();

    // The expand_home+canonicalize path will resolve the symlink and
    // realize it's outside home, so the scope check rejects it here.
    // (The O_NOFOLLOW guard is defense-in-depth for the TOCTOU race
    // where the symlink is introduced between canonicalize and open.)
    let result = read_file(ReadFileRequest {
        path: link.to_string_lossy().to_string(),
    });

    assert!(result.is_err(), "symlink-escape read must be rejected");
    let err = result.unwrap_err();
    assert!(
        err.contains("access denied") || err.contains("invalid path"),
        "expected scope rejection, got: {}",
        err
    );

    let _ = fs::remove_file(&outside_target);
    let _ = fs::remove_dir_all(&dir);
}
