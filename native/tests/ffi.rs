use otools_yoyomusic_native::{otools_plugin_free, otools_plugin_invoke};
use serde_json::Value;
use std::ptr;

const HEALTH: &[u8] = br#"{"method":"__otools_health__","payload":{}}"#;

unsafe fn invoke_bytes(input: *const u8, input_len: usize) -> Vec<u8> {
    let mut output_len = usize::MAX;
    let output = unsafe { otools_plugin_invoke(input, input_len, &mut output_len) };
    assert!(!output.is_null(), "invoke must return an owned JSON buffer");
    assert!(
        output_len > 0 && output_len < 8 * 1024 * 1024,
        "invalid output length: {output_len}"
    );
    let bytes = unsafe { std::slice::from_raw_parts(output, output_len) }.to_vec();
    unsafe { otools_plugin_free(output, output_len) };
    bytes
}

#[test]
fn exported_functions_have_the_host_abi_signatures() {
    let _: unsafe extern "C" fn(*const u8, usize, *mut usize) -> *mut u8 = otools_plugin_invoke;
    let _: unsafe extern "C" fn(*mut u8, usize) = otools_plugin_free;
}

#[test]
fn ffi_health_roundtrips_json_bytes_and_frees_the_exact_buffer() {
    for _ in 0..32 {
        let bytes = unsafe { invoke_bytes(HEALTH.as_ptr(), HEALTH.len()) };
        let response: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(response["ok"], true);
        assert_eq!(response["data"]["id"], "otools-yoyomusic");
        assert_eq!(response["data"]["version"], "0.1.3");
    }
}

#[test]
fn ffi_null_output_length_returns_null_without_reading_input() {
    let output = unsafe { otools_plugin_invoke(ptr::null(), usize::MAX, ptr::null_mut()) };
    assert!(output.is_null());
}

#[test]
fn ffi_null_input_returns_owned_error_json_for_any_length() {
    for len in [0, 1, usize::MAX] {
        let bytes = unsafe { invoke_bytes(ptr::null(), len) };
        let response: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(response["ok"], false);
        assert!(response["error"].as_str().unwrap().contains("input buffer"));
    }
}

#[test]
fn ffi_oversized_input_is_rejected_before_json_parsing() {
    let input = vec![b' '; 1024 * 1024 + 1];
    let bytes = unsafe { invoke_bytes(input.as_ptr(), input.len()) };
    let response: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"].as_str().unwrap().contains("input buffer"));
}

#[test]
fn ffi_empty_nonnull_input_returns_an_invalid_json_error() {
    let input = [];
    let bytes = unsafe { invoke_bytes(input.as_ptr(), input.len()) };
    let response: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"].as_str().unwrap().contains("JSON"));
}

#[test]
fn ffi_invalid_json_roundtrips_an_error_and_can_be_freed() {
    let input = b"{not json}";
    let bytes = unsafe { invoke_bytes(input.as_ptr(), input.len()) };
    let response: Value = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(response["ok"], false);
    assert!(response["error"].is_string());
}

#[test]
fn ffi_free_accepts_null_without_accessing_memory() {
    unsafe {
        otools_plugin_free(ptr::null_mut(), 0);
        otools_plugin_free(ptr::null_mut(), usize::MAX);
    }
}
