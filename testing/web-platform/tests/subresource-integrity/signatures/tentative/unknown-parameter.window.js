// META: script=helper.js

// The following tests validate the behavior of unknown signature parameters.
// They'll all be rooted in the following response, generated using the steps at
// https://wicg.github.io/signature-based-sri/#examples, relying on the test
// key from https://www.rfc-editor.org/rfc/rfc9421.html#name-example-ed25519-test-key:
//
// ```
// NOTE: '\' line wrapping per RFC 8792
//
// HTTP/1.1 200 OK
// Date: Tue, 20 Apr 2021 02:07:56 GMT
// Content-Type: application/json
// Unencoded-Digest: sha-256=:X48E9qOokqqrvdts8nOJRJN3OWDUoyWxBf7kbu9DBPE=:
// Content-Length: 18
// Signature-Input: signature=("unencoded-digest";sf "@status"); \
//                  keyid="JrQLj5P/89iXES9+vFgrIy29clF9CC/oPPsw3c5D0bs=";       \
//                  tag="sri"
// Signature: signature=:oVQ+s/OqXLAVdfvgZ3HaPiyzkpNXZSit9l6e1FB/gOOL3t8FOrIRDV \
//                       CkcIEcJjd3MA1mROn39/WQShTmnKmlDg==:
//
//
// {"hello": "world"}
// ```

// Metadata from the response above:
const kRequestsWithValidSignature = [
  // ```
  // "unencoded-digest";sf: sha-256=:PZJ+9CdAAIacg7wfUe4t/RkDQJVKM0mCZ2K7qiRhHFc=:
  // "@signature-params": ("unencoded-digest";sf "@status");keyid="JrQLj5P/89iXES9+vFgrIy29clF9CC/oPPsw3c5D0bs=";tag="sri";unknown=1
  // ```
  {
    body: "window.hello = `world`;",
    digest: "sha-256=:PZJ+9CdAAIacg7wfUe4t/RkDQJVKM0mCZ2K7qiRhHFc=:",
    signature: `signature=:eZ2DGIHUsTNMxFReOMkbOrTmn+CqDckCZ5/635x1Apl2ws0nA+qZcHqZFMdjBvcGw0WElh3zYD0ynkQ+cHiWCA==:`,
    signatureInput: `signature=("unencoded-digest";sf);keyid="${kValidKeys['rfc']}";tag="sri";unknown=1`
  },
  // ```
  // "unencoded-digest";sf: sha-256=:PZJ+9CdAAIacg7wfUe4t/RkDQJVKM0mCZ2K7qiRhHFc=:
  // "@signature-params": ("unencoded-digest";sf "@status");unknown=1;keyid="JrQLj5P/89iXES9+vFgrIy29clF9CC/oPPsw3c5D0bs=";tag="sri"
  // ```
  {
    body: "window.hello = `world`;",
    digest: "sha-256=:PZJ+9CdAAIacg7wfUe4t/RkDQJVKM0mCZ2K7qiRhHFc=:",
    signature: `signature=:YXQH8lkKBcGOMNSFbS56j3d5nK3j15HbFPIdsljzQVGFFd93T6FmXb2cLsoINYQbnMUOQBSROIzFZpgUQTBTBA==:`,
    signatureInput: `signature=("unencoded-digest";sf);unknown=1;keyid="${kValidKeys['rfc']}";tag="sri"`
  },
];

// Valid signatures depend upon integrity checks.
//
// We're testing our handling of malformed and multiple keys generally in
// the broader `client-initiated.*` tests. Here we'll just focus on ensuring
// that responses with unknown parameters load at all (no integrity check),
// load when integrity checks match, and fail when integrity checks mismatch.
for (const request of kRequestsWithValidSignature) {
    // fetch():
    generate_fetch_test(request, {}, EXPECT_LOADED,
                        `Valid signature (${request.signature}), no integrity check: loads.`);
    generate_fetch_test(request, {integrity:`ed25519-${kValidKeys['rfc']}`}, EXPECT_LOADED,
                        `Valid signature (${request.signature}), matching integrity check: loads.`);

    generate_fetch_test(request, {integrity:`ed25519-${kInvalidKey}`}, EXPECT_BLOCKED,
                        `Valid signature (${request.signature}), mismatched integrity check: blocked.`);

    // <script>:
    generate_script_test(request, "", EXPECT_LOADED,
                        `Valid signature (${request.signature}), no integrity check: loads.`);
    generate_script_test(request, `ed25519-${kValidKeys['rfc']}`, EXPECT_LOADED,
                        `Valid signature (${request.signature}), matching integrity check: loads.`);
    generate_script_test(request, `ed25519-${kInvalidKey}`, EXPECT_BLOCKED,
                        `Valid signature (${request.signature}), mismatched integrity check: blocked.`);
}
