// Interop vector generator.
//
// Produces the fixture file the browser tests read, from the same primitives the
// sharing app uses: CryptoKit and Foundation, nothing else. The point of a
// separate producer is that the vectors are not produced by the code under test.
// A test that encrypts with the implementation it is checking proves the
// implementation agrees with itself; these vectors are made elsewhere, in
// another language, on another stack, and the viewer has to agree with them.
//
// Usage, from the repository root:
//
//     swift test/vectors/GenerateVectors.swift
//
// It writes `vectors.json` beside this file and prints a summary. Every input is
// a fixed, obviously synthetic value written into this file — a counting pattern
// or a constant run — so a re-run reproduces the output byte for byte. A vector
// file that changed every time it was regenerated could not be reviewed as a
// diff.
//
// NOTHING HERE IS SECRET. The keys below are counting patterns and constant runs
// typed into a public source file. They protect nothing, they came from no real
// share, and no real key is ever a value anyone typed.
//
// The generator also pins its own canonicalisation. Each canonical string it
// emits is byte-compared against a literal written out by hand, and a mismatch
// aborts the run rather than writing a file. The viewer never canonicalises
// anything — it authenticates the bytes it was given — so this is the only place
// the canonical form is computed, and it is checked against a fixed answer
// rather than trusted.
//
// The canonicaliser refuses rather than approximating. Its stated domain is the
// value kinds this file writes, and anything it cannot represent exactly — an
// integer outside the range JSON numbers carry losslessly, an object with a
// member name written twice — aborts the run instead of being emitted. The same
// refusals apply to the emitted graph, not only to the canonical form: the file
// is the artefact everything downstream reads, so a duplicate member has to stop
// the run whichever of the two forms it would have been written into.
//
// Every one of those refusals is a thrown error rather than a trap, so a guard
// can be exercised rather than only declared. One of the two is:
// `checkMemberNameGuard` below runs the member-name guard against a case it must
// refuse and a case it must accept, before anything is written. The
// integer-range refusal is not — nothing runs it against a value outside the
// range, so what holds it is this sentence and the reading of the code, which is
// less than the other one has and is said here rather than left to read as
// though both were covered.

import CryptoKit
import Foundation

// MARK: - Refusals

/// What the generator will not do, rather than do approximately.
///
/// Thrown rather than trapped so the guards themselves can be checked: a guard
/// that aborts the process cannot be shown to fire on the input it is for, and
/// this file's guards are exactly the kind that can be wrong in both directions.
enum GeneratorError: Error, CustomStringConvertible {
  case integerNotExactlyRepresentable(Int)
  case memberNamedMoreThanOnce([String])
  case pinMismatch(what: String, produced: String, pinned: String)
  case malformed(String)
  case selfCheckFailed(String)

  var description: String {
    switch self {
    case .integerNotExactlyRepresentable(let number):
      return "integer \(number) is outside the exactly representable range"
    case .memberNamedMoreThanOnce(let names):
      return "object names a member more than once: \(names.sorted())"
    case .pinMismatch(let what, let produced, let pinned):
      return "\(what) does not match its pinned expectation:\n  got      \(produced)\n  expected \(pinned)"
    case .malformed(let detail):
      return detail
    case .selfCheckFailed(let detail):
      return "self-check failed: \(detail)"
    }
  }
}

/// Are these the same string in the sense a reader of these bytes would see —
/// the same sequence of UTF-16 code units?
///
/// `==` on Swift strings is canonical equivalence, so it answers yes for two
/// strings that are different JSON. Every comparison in this file that is a
/// claim about emitted bytes goes through here instead.
func sameCodeUnits(_ lhs: String, _ rhs: String) -> Bool {
  Array(lhs.utf16) == Array(rhs.utf16)
}

// MARK: - JSON

/// A JSON value, with object members held in the order they were written.
///
/// Order is kept because two different orderings are two different documents to
/// anything that compares bytes, and both the emitted file and the canonical
/// form need to be exactly reproducible.
indirect enum JSON {
  case string(String)
  case int(Int)
  case bool(Bool)
  case array([JSON])
  case object([(String, JSON)])
}

/// Escape a string as a JSON string literal.
///
/// Short escapes where they exist, `\u00xx` in lowercase hex for the remaining
/// control characters, and every other scalar passed through as itself.
func jsonString(_ value: String) -> String {
  var out = "\""
  for scalar in value.unicodeScalars {
    switch scalar {
    case "\"": out += "\\\""
    case "\\": out += "\\\\"
    case "\u{08}": out += "\\b"
    case "\u{09}": out += "\\t"
    case "\u{0A}": out += "\\n"
    case "\u{0C}": out += "\\f"
    case "\u{0D}": out += "\\r"
    default:
      if scalar.value < 0x20 {
        out += String(format: "\\u%04x", scalar.value)
      } else {
        out.unicodeScalars.append(scalar)
      }
    }
  }
  return out + "\""
}

/// Order two member names by UTF-16 code unit, which is the ordering canonical
/// JSON specifies.
func memberOrder(_ lhs: String, _ rhs: String) -> Bool {
  Array(lhs.utf16).lexicographicallyPrecedes(Array(rhs.utf16))
}

/// The largest integer magnitude a JSON number carries losslessly through a
/// double, which is what every reader of these vectors parses one into.
let maximumExactInteger = 9_007_199_254_740_991

/// No member may be named twice.
///
/// Applied to every object this file turns into text, in either form. A JSON
/// object with a repeated name has no agreed meaning: readers keep the first,
/// the last, or refuse, so a file carrying one says different things to
/// different readers and is not a vector.
///
/// The comparison is over UTF-16 code units, which is the same thing
/// `memberOrder` sorts by, and it has to be. Swift's `==` on strings compares
/// for canonical equivalence, so it calls "é" and "e" followed by a combining
/// acute one string — while JSON, and the ordering just above, call them two.
/// A guard written with `Set<String>` therefore disagreed with the ordering it
/// was guarding, and disagreed in the direction that refuses a legitimate
/// object rather than the direction that admits a bad one.
func checkMemberNames(_ members: [(String, JSON)]) throws {
  let keys = members.map { Array($0.0.utf16) }
  guard Set(keys).count == keys.count else {
    throw GeneratorError.memberNamedMoreThanOnce(members.map { $0.0 })
  }
}

/// The canonical form: members sorted, no whitespace, integers as digits.
///
/// Restricted on purpose to the value kinds this file writes — string, integer,
/// boolean, array, object. Floating point is the hard part of canonical JSON and
/// none of it is reachable from a schema with no floating point in it, so it is
/// absent rather than approximated. The additional authenticated data uses a
/// subset of even this: strings, one integer and one boolean in a flat object.
///
/// Outside that domain it refuses. An integer a reader could not parse back
/// exactly, or an object naming the same member twice, stops the run — a
/// canonical form is a claim about bytes, and a canonicaliser that quietly
/// emitted something ambiguous would make that claim untrue.
func canonical(_ value: JSON) throws -> String {
  switch value {
  case .string(let text):
    return jsonString(text)
  case .int(let number):
    // Written as a pair of comparisons rather than as `abs`, which traps on the
    // most negative integer — the one value most in need of the check.
    guard number >= -maximumExactInteger, number <= maximumExactInteger else {
      throw GeneratorError.integerNotExactlyRepresentable(number)
    }
    return String(number)
  case .bool(let flag):
    return flag ? "true" : "false"
  case .array(let items):
    return "[" + (try items.map(canonical).joined(separator: ",")) + "]"
  case .object(let members):
    try checkMemberNames(members)
    let sorted = members.sorted { memberOrder($0.0, $1.0) }
    let body = try sorted.map { jsonString($0.0) + ":" + (try canonical($0.1)) }.joined(separator: ",")
    return "{" + body + "}"
  }
}

/// The emitted form: members in written order, two-space indent, one value per
/// line. Deterministic, and readable as a diff.
///
/// Held to the same member-name guard as the canonical form. It was not, and the
/// gap was the one that mattered: only the additional authenticated data is
/// canonicalised, so an object naming a member twice anywhere else in the graph
/// went through this function and into the file without complaint.
func pretty(_ value: JSON, indent: Int = 0) throws -> String {
  let pad = String(repeating: "  ", count: indent)
  let inner = String(repeating: "  ", count: indent + 1)
  switch value {
  case .string, .int, .bool:
    return try canonical(value)
  case .array(let items):
    if items.isEmpty { return "[]" }
    let body = try items.map { inner + (try pretty($0, indent: indent + 1)) }.joined(separator: ",\n")
    return "[\n" + body + "\n" + pad + "]"
  case .object(let members):
    try checkMemberNames(members)
    if members.isEmpty { return "{}" }
    let body = try members
      .map { inner + jsonString($0.0) + ": " + (try pretty($0.1, indent: indent + 1)) }
      .joined(separator: ",\n")
    return "{\n" + body + "\n" + pad + "}"
  }
}

/// The member-name guard, run against a case it must refuse and a case it must
/// accept, before anything is written.
///
/// Both directions, because both have been wrong. The refusal was missing from
/// the emitted form entirely; the acceptance was broken by comparing Swift
/// strings, which made two distinct names look like one.
func checkMemberNameGuard() throws {
  // First the comparison the guard and the pins are both written in terms of.
  // Swift says these two strings are equal, because it compares for canonical
  // equivalence; a reader of these bytes says they are not. Every claim in this
  // file about what was emitted is a claim about bytes, so a comparison that
  // cannot tell them apart is the wrong one everywhere it appears.
  let precomposedMark = "\u{00E9}"
  let decomposedMark = "e\u{0301}"
  guard precomposedMark == decomposedMark else {
    throw GeneratorError.selfCheckFailed(
      "this Swift no longer treats canonically equivalent strings as equal, so the comparisons here need rereading"
    )
  }
  guard !sameCodeUnits(precomposedMark, decomposedMark) else {
    throw GeneratorError.selfCheckFailed(
      "sameCodeUnits calls two different sequences of code units the same string"
    )
  }
  guard sameCodeUnits(decomposedMark, "e\u{0301}") else {
    throw GeneratorError.selfCheckFailed("sameCodeUnits calls one string two")
  }

  let duplicated = JSON.object([("a", .int(1)), ("a", .int(2))])
  let forms: [(String, () throws -> String)] = [
    ("canonical", { try canonical(duplicated) }),
    ("pretty", { try pretty(duplicated) }),
  ]
  for (what, produce) in forms {
    do {
      _ = try produce()
      throw GeneratorError.selfCheckFailed("\(what) accepted an object naming a member twice")
    } catch GeneratorError.memberNamedMoreThanOnce {
      // As required.
    }
  }

  // Two names that are canonically equivalent are still two names. Written from
  // scalars rather than typed as characters, because the whole point is a
  // difference that is invisible when it is looked at.
  let precomposed = precomposedMark
  let decomposed = decomposedMark
  let distinct = JSON.object([(precomposed, .int(1)), (decomposed, .int(2))])
  let produced = try canonical(distinct)
  // Sorted by code unit, so the decomposed spelling — which starts with `e` —
  // comes first.
  let expected = "{\"" + decomposed + "\":2,\"" + precomposed + "\":1}"
  guard sameCodeUnits(produced, expected) else {
    throw GeneratorError.pinMismatch(
      what: "canonicalisation of two canonically equivalent member names",
      produced: produced,
      pinned: expected
    )
  }
}

// MARK: - Bytes

/// A run of `count` bytes starting at `start`, wrapping at 256.
///
/// Most keys, nonces and identifiers below are one of these. They are patterns,
/// and they are meant to look like patterns.
func patternBytes(start: UInt8, count: Int) -> Data {
  var data = Data(capacity: count)
  for offset in 0..<count {
    data.append(UInt8((Int(start) + offset) % 256))
  }
  return data
}

/// `count` copies of one byte.
///
/// The other shape a value here takes. All-zero and all-ones key material is
/// worth covering precisely because it is the shape an implementation is most
/// likely to special-case, skip, or mistake for absent.
func constantBytes(_ byte: UInt8, count: Int) -> Data {
  Data(repeating: byte, count: count)
}

/// Unpadded base64url.
func base64url(_ data: Data) -> String {
  data.base64EncodedString()
    .replacingOccurrences(of: "+", with: "-")
    .replacingOccurrences(of: "/", with: "_")
    .replacingOccurrences(of: "=", with: "")
}

// MARK: - Scheme

let kekInfo = Data("patientscribe/link_split_v1/kek".utf8)

/// The key the content key is wrapped under: HKDF-SHA-256 over the link
/// capability followed by the stored key, salted with the share identifier.
func deriveKek(linkKey: Data, serverKey: Data, shareId: Data) -> SymmetricKey {
  HKDF<SHA256>.deriveKey(
    inputKeyMaterial: SymmetricKey(data: linkKey + serverKey),
    salt: shareId,
    info: kekInfo,
    outputByteCount: 32
  )
}

/// A sealed blob in wire form: nonce, then ciphertext, then tag.
func seal(_ plaintext: Data, using key: SymmetricKey, nonce: Data, aad: Data?) throws -> String {
  let gcmNonce = try AES.GCM.Nonce(data: nonce)
  let box: AES.GCM.SealedBox
  if let aad {
    box = try AES.GCM.seal(plaintext, using: key, nonce: gcmNonce, authenticating: aad)
  } else {
    box = try AES.GCM.seal(plaintext, using: key, nonce: gcmNonce)
  }
  let wire = nonce + box.ciphertext + box.tag
  guard let combined = box.combined, combined == wire else {
    fatalError("sealed box does not match the nonce || ciphertext || tag wire form")
  }
  return base64url(wire)
}

// MARK: - Fixtures

/// One end-to-end share: everything needed to reproduce it, and what it produces.
struct Fixture {
  let name: String
  let note: String
  let linkKeyStart: UInt8
  let serverKeyStart: UInt8
  let contentKeyStart: UInt8
  let shareIdStart: UInt8
  let wrapNonceStart: UInt8
  let contentNonceStart: UInt8
  let aad: JSON
  /// The canonical AAD, written out by hand. The generator checks its own
  /// canonicaliser against this rather than publishing whatever it produced.
  ///
  /// It is also the string that gets sealed. There is no way to seal anything
  /// else, and that is deliberate: the protocol says the authenticated data is
  /// canonical JSON, so a vector sealed over some other spelling of it would be
  /// a conformance target that a correct producer could not hit and a correct
  /// reader would be right to refuse. One fixture was once sealed with a
  /// trailing space, to make "the viewer hands back the string that was sealed"
  /// checkable against a string that tidying would change; what it actually
  /// published was a vector outside the protocol's own valid domain. The
  /// property it was reaching for is still covered, by the decomposed sequences
  /// in `combining-marks`: those are valid canonical JSON and any normalisation,
  /// at any point, changes them. Outer trimming cannot change a canonical JSON
  /// document, so trimming is equivalent to doing nothing on every string this
  /// protocol admits, and there is nothing there to catch.
  let expectedAad: String
  /// The document, exactly as it is encrypted. Member order varies between
  /// fixtures on purpose: a reader of these bytes must not require any.
  let plaintext: String
}

let fixtures: [Fixture] = [
  Fixture(
    name: "named",
    note: "A named recipient, unedited, two sections.",
    linkKeyStart: 0x10,
    serverKeyStart: 0x30,
    contentKeyStart: 0x50,
    shareIdStart: 0x00,
    wrapNonceStart: 0x70,
    contentNonceStart: 0x80,
    aad: .object([
      ("v", .string("link_split_v1")),
      ("id", .string("AAECAwQFBgcICQoLDA0ODw")),
      ("doc", .string("share_doc_v1")),
      ("exp", .int(1_767_225_600)),
      ("edited", .bool(false)),
      ("sfv", .string("1")),
    ]),
    expectedAad:
      #"{"doc":"share_doc_v1","edited":false,"exp":1767225600,"id":"AAECAwQFBgcICQoLDA0ODw","sfv":"1","v":"link_split_v1"}"#,
    plaintext:
      #"{"schema":"share_doc_v1","banner_key":"relay_banner_shared_v1","banner_text":"Example banner text.","you_means":"Example Name","edited":false,"visit_date":"2026-01-15","topic":"Example topic","sections":[{"heading":"Example heading one","lines":["Example line one.","Example line two."]},{"heading":"Example heading two","lines":["Example line three."]}]}"#
  ),
  Fixture(
    name: "nameless",
    note: "The nameless fallback: you_means is empty, which is a value and not an absence. Document members are in a scrambled order.",
    linkKeyStart: 0xA0,
    serverKeyStart: 0xC0,
    contentKeyStart: 0xE0,
    shareIdStart: 0x20,
    wrapNonceStart: 0x11,
    contentNonceStart: 0x22,
    aad: .object([
      ("v", .string("link_split_v1")),
      ("id", .string("ICEiIyQlJicoKSorLC0uLw")),
      ("doc", .string("share_doc_v1")),
      ("exp", .int(1_769_904_000)),
      ("edited", .bool(false)),
      ("sfv", .string("1")),
    ]),
    expectedAad:
      #"{"doc":"share_doc_v1","edited":false,"exp":1769904000,"id":"ICEiIyQlJicoKSorLC0uLw","sfv":"1","v":"link_split_v1"}"#,
    plaintext:
      #"{"you_means":"","schema":"share_doc_v1","edited":false,"banner_key":"relay_banner_shared_v1","sections":[{"lines":["Example line one."],"heading":"Example heading"}],"topic":"Example topic","visit_date":"2026-02-20","banner_text":"Example banner text."}"#
  ),
  Fixture(
    name: "edited",
    note: "Edited before sharing, so both the document and the authenticated copy say so. One section with no lines.",
    linkKeyStart: 0x33,
    serverKeyStart: 0x55,
    contentKeyStart: 0x77,
    shareIdStart: 0x40,
    wrapNonceStart: 0x99,
    contentNonceStart: 0xBB,
    aad: .object([
      ("v", .string("link_split_v1")),
      ("id", .string("QEFCQ0RFRkdISUpLTE1OTw")),
      ("doc", .string("share_doc_v1")),
      ("exp", .int(1_772_323_200)),
      ("edited", .bool(true)),
      ("sfv", .string("abc123")),
    ]),
    expectedAad:
      #"{"doc":"share_doc_v1","edited":true,"exp":1772323200,"id":"QEFCQ0RFRkdISUpLTE1OTw","sfv":"abc123","v":"link_split_v1"}"#,
    plaintext:
      #"{"schema":"share_doc_v1","banner_key":"relay_banner_shared_v1","banner_text":"Example banner text.","you_means":"Example Name","edited":true,"visit_date":"2026-03-05","topic":"Example topic","sections":[{"heading":"Example heading","lines":[]}]}"#
  ),
  Fixture(
    name: "wide-characters",
    note: "Text outside ASCII in every free-text field, and no sections at all. The plaintext is multi-byte UTF-8 and the decoder has to agree about it.",
    linkKeyStart: 0x02,
    serverKeyStart: 0x04,
    contentKeyStart: 0x08,
    shareIdStart: 0x60,
    wrapNonceStart: 0x0C,
    contentNonceStart: 0x0E,
    aad: .object([
      ("v", .string("link_split_v1")),
      ("id", .string("YGFiY2RlZmdoaWprbG1ubw")),
      ("doc", .string("share_doc_v1")),
      ("exp", .int(1_775_001_600)),
      ("edited", .bool(false)),
      ("sfv", .string("1")),
    ]),
    expectedAad:
      #"{"doc":"share_doc_v1","edited":false,"exp":1775001600,"id":"YGFiY2RlZmdoaWprbG1ubw","sfv":"1","v":"link_split_v1"}"#,
    plaintext:
      #"{"schema":"share_doc_v1","banner_key":"relay_banner_shared_v1","banner_text":"Example banner text — em dash, café, 日本語.","you_means":"Éxample Nàme","edited":false,"visit_date":"2026-04-11","topic":"Ejemplo — 主题","sections":[]}"#
  ),
  Fixture(
    name: "replacement-character",
    note:
      "The authenticated data carries U+FFFD, the replacement character. This exists so a reader can be tested for one specific mistake: encoding UTF-16 to UTF-8 maps an unpaired surrogate to the same three bytes as U+FFFD, so a reader that only checks the tag would accept a string spelled with a surrogate as though it were this one. The bytes sealed here are the bytes of this string, and no other string may authenticate against them.",
    linkKeyStart: 0x81,
    serverKeyStart: 0xA3,
    contentKeyStart: 0xC5,
    shareIdStart: 0x80,
    wrapNonceStart: 0x2A,
    contentNonceStart: 0x3C,
    aad: .object([
      ("v", .string("link_split_v1")),
      ("id", .string("gIGCg4SFhoeIiYqLjI2Ojw")),
      ("doc", .string("share_doc_v1")),
      ("exp", .int(1_777_680_000)),
      ("edited", .bool(false)),
      ("sfv", .string("1\u{FFFD}")),
    ]),
    expectedAad:
      "{\"doc\":\"share_doc_v1\",\"edited\":false,\"exp\":1777680000,\"id\":\"gIGCg4SFhoeIiYqLjI2Ojw\",\"sfv\":\"1\u{FFFD}\",\"v\":\"link_split_v1\"}",
    plaintext:
      #"{"schema":"share_doc_v1","banner_key":"relay_banner_shared_v1","banner_text":"Example banner text.","you_means":"Example Name","edited":false,"visit_date":"2026-05-19","topic":"Example topic","sections":[{"heading":"Example heading","lines":["Example line one."]}]}"#
  ),
  Fixture(
    name: "combining-marks",
    note:
      "Every string here is chosen so that tidying it would change it. The authenticated data and the document both carry decomposed sequences — a letter followed by a combining mark, where a precomposed character exists — so any normalisation, at any point, produces different bytes: before the tag check it breaks the tag, and on the way back out it hands the reader a string that was never sealed. The document is sealed with a trailing newline, so trimming it is visible too; the authenticated data is canonical JSON, which outer trimming cannot change, so there is no trimming of it to catch. None of this is a shape the sharing app produces; all of it is a shape a reader must not quietly repair, and the fixtures that came before it were all invariant under exactly the repairs worth catching.",
    linkKeyStart: 0x13,
    serverKeyStart: 0x37,
    contentKeyStart: 0x5B,
    shareIdStart: 0xB0,
    wrapNonceStart: 0x4D,
    contentNonceStart: 0x6F,
    aad: .object([
      ("v", .string("link_split_v1")),
      ("id", .string("sLGys7S1tre4ubq7vL2-vw")),
      ("doc", .string("share_doc_v1")),
      ("exp", .int(1_780_358_400)),
      ("edited", .bool(false)),
      ("sfv", .string("1e\u{0301}")),
    ]),
    expectedAad:
      #"{"doc":"share_doc_v1","edited":false,"exp":1780358400,"id":"sLGys7S1tre4ubq7vL2-vw","sfv":"1e\#u{0301}","v":"link_split_v1"}"#,
    plaintext:
      #"{"schema":"share_doc_v1","banner_key":"relay_banner_shared_v1","banner_text":"Example banner text: cafe\#u{0301}.","you_means":"E\#u{0301}xample Na\#u{0300}me","edited":false,"visit_date":"2026-06-24","topic":"Ejemplo: nin\#u{0303}o","sections":[{"heading":"Example heading","lines":["Example line one: resume\#u{0301}."]}]}\#n"#
  ),
  Fixture(
    name: "astral-characters",
    note:
      "The authenticated data and the document both carry characters outside the basic multilingual plane, which a reader holds as surrogate pairs. This is the accepting direction of the well-formedness test that the replacement-character fixture puts the refusing direction of: a reader that refuses every surrogate — rather than every unpaired one — refuses every emoji and every astral character, and until this fixture existed no vector in the corpus contained one, so that mistake decrypted everything there was to decrypt.",
    linkKeyStart: 0x25,
    serverKeyStart: 0x47,
    contentKeyStart: 0x69,
    shareIdStart: 0xD0,
    wrapNonceStart: 0x5E,
    contentNonceStart: 0x7A,
    aad: .object([
      ("v", .string("link_split_v1")),
      ("id", .string("0NHS09TV1tfY2drb3N3e3w")),
      ("doc", .string("share_doc_v1")),
      ("exp", .int(1_783_036_800)),
      ("edited", .bool(true)),
      ("sfv", .string("1\u{1F600}")),
    ]),
    expectedAad:
      "{\"doc\":\"share_doc_v1\",\"edited\":true,\"exp\":1783036800,\"id\":\"0NHS09TV1tfY2drb3N3e3w\",\"sfv\":\"1\u{1F600}\",\"v\":\"link_split_v1\"}",
    plaintext:
      "{\"schema\":\"share_doc_v1\",\"banner_key\":\"relay_banner_shared_v1\",\"banner_text\":\"Example banner text \u{1F600}.\",\"you_means\":\"Example Name\",\"edited\":true,\"visit_date\":\"2026-07-30\",\"topic\":\"Example topic \u{1D11E}\",\"sections\":[{\"heading\":\"Example heading \u{1F4C4}\",\"lines\":[\"Example line one \u{1F600}.\"]}]}"
  ),
]

/// One derivation, on its own.
///
/// A derived key is never extractable in the viewer, so a test there cannot
/// compare key bytes. Each of these therefore carries a probe: a fixed 32-byte
/// value wrapped under the derived key. An implementation that derives the same
/// key unwraps the probe, and one that does not, does not — which is the same
/// assertion made through the only door a non-extractable key leaves open. The
/// key bytes are published alongside it for implementations that can compare
/// them directly.
struct Derivation {
  let name: String
  let note: String
  let linkKey: Data
  let serverKey: Data
  let shareId: Data
  let probeKey: Data
  let probeNonce: Data
}

let derivations: [Derivation] = [
  Derivation(
    name: "matches-named-fixture",
    note: "The same inputs as the named fixture, so a derivation failure and a decryption failure can be told apart.",
    linkKey: patternBytes(start: 0x10, count: 32),
    serverKey: patternBytes(start: 0x30, count: 32),
    shareId: patternBytes(start: 0x00, count: 16),
    probeKey: patternBytes(start: 0x40, count: 32),
    probeNonce: patternBytes(start: 0x50, count: 12)
  ),
  Derivation(
    name: "extreme-halves",
    note: "All-zero link capability, all-ones stored key, all-zero salt. Every byte of each is that value and no other.",
    linkKey: constantBytes(0x00, count: 32),
    serverKey: constantBytes(0xFF, count: 32),
    shareId: constantBytes(0x00, count: 16),
    probeKey: patternBytes(start: 0x40, count: 32),
    probeNonce: patternBytes(start: 0x50, count: 12)
  ),
  Derivation(
    name: "salt-sensitivity",
    note: "The halves of the previous derivation with a different salt: all-ones rather than all-zero. The derived key must be unrelated, so the previous probe must not unwrap under it.",
    linkKey: constantBytes(0x00, count: 32),
    serverKey: constantBytes(0xFF, count: 32),
    shareId: constantBytes(0xFF, count: 16),
    probeKey: patternBytes(start: 0x40, count: 32),
    probeNonce: patternBytes(start: 0x50, count: 12)
  ),
]

/// A canonicalisation case: a value, and the string it must produce.
struct Canonicalisation {
  let name: String
  let note: String
  let value: JSON
  let expected: String
}

/// The canonicalisation records.
///
/// One of these is a share's authenticated data written in a different order.
/// The other three are not authenticated data at all, and cannot be: what they
/// put to the canonicaliser is escaping, member ordering by code unit, and the
/// spelling of integers, and an authenticated document has six fixed member
/// names carrying fixed types — there is no valid one whose members sort in an
/// interesting order, or whose strings need escaping, or that carries a negative
/// integer. So each input is chosen for the rule its record is about, and until
/// now the difference between "a share" and "a value" was visible only by
/// reading them next to the schema.
///
/// Each note says which it is. A reader implementing the producing side must
/// canonicalise all four to the strings published beside them; a reader
/// implementing the consuming side must refuse three of the four as documents,
/// and refusing them is agreement with these vectors rather than a failure
/// against them.
let canonicalisations: [Canonicalisation] = [
  Canonicalisation(
    name: "member-order-is-not-input-order",
    note: "A share's authenticated data with its members written in a different order. Canonicalisation must reach the same bytes. This is the one record here whose input is a document this protocol carries; the three below are values chosen to put one rule of the form to a canonicaliser, and are not documents any part of this protocol accepts.",
    value: .object([
      ("sfv", .string("1")),
      ("v", .string("link_split_v1")),
      ("exp", .int(1_767_225_600)),
      ("doc", .string("share_doc_v1")),
      ("id", .string("AAECAwQFBgcICQoLDA0ODw")),
      ("edited", .bool(false)),
    ]),
    expected:
      #"{"doc":"share_doc_v1","edited":false,"exp":1767225600,"id":"AAECAwQFBgcICQoLDA0ODw","sfv":"1","v":"link_split_v1"}"#
  ),
  Canonicalisation(
    name: "string-escapes",
    note: "Short escapes for the characters that have them, and nothing escaped that does not need to be. Not a share's authenticated data: the member names and values are chosen to put the escaping rule to a canonicaliser, which the six fixed members of an authenticated document cannot do. Canonicalise it; do not accept it as a document.",
    value: .object([
      ("b", .string("quote\" backslash\\ tab\t newline\n unit\u{1F}")),
      ("a", .string("plain")),
    ]),
    expected: #"{"a":"plain","b":"quote\" backslash\\ tab\t newline\n unit\u001f"}"#
  ),
  Canonicalisation(
    name: "member-order-is-by-code-unit",
    note: "Sorting is by UTF-16 code unit, not by any locale's idea of alphabetical order. Not a share's authenticated data: the member names are chosen so that the two orderings disagree, which the fixed member names of an authenticated document cannot do. Canonicalise it; do not accept it as a document.",
    value: .object([
      ("é", .int(1)),
      ("a", .int(2)),
      ("Z", .int(3)),
      ("", .int(4)),
    ]),
    expected: #"{"":4,"Z":3,"a":2,"é":1}"#
  ),
  Canonicalisation(
    name: "integers",
    note: "Integers as digits, with no exponent, no trailing zeros and no sign but a minus. Not a share's authenticated data: an authenticated document carries one integer and it is an expiry, so nothing in it can be zero or negative. Canonicalise it; do not accept it as a document.",
    value: .object([
      ("n", .int(0)),
      ("neg", .int(-1)),
      ("big", .int(9_007_199_254_740_991)),
    ]),
    expected: #"{"big":9007199254740991,"n":0,"neg":-1}"#
  ),
]

/// The share a reader decrypts to find out whether it can decrypt anything.
///
/// A reader that cannot do this scheme is a reader that will refuse every share
/// it is ever handed, and the refusal it gives is the same one it gives for a
/// share that has expired — which is a recipient told to ask the sender about
/// something the sender cannot fix. So a reader may run one known share of its
/// own, first, and say something useful when that share does not come back.
///
/// Its authenticated data is non-empty on purpose. An empty one would seal and
/// open identically whether the additional data reached the tag or not, so a
/// reader that dropped it entirely would pass its own check and then fail every
/// real share.
///
/// Everything else about it is an ordinary share of this scheme: the same
/// derivation, the same wrap, the same wire form. What is different is that it
/// carries no document and no identifier a validator would recognise — it is a
/// probe, and nothing about it should be read as a share of a note.
struct CapabilityFixture {
  let linkKeyStart: UInt8
  let serverKeyStart: UInt8
  let contentKeyStart: UInt8
  let shareIdStart: UInt8
  let wrapNonceStart: UInt8
  let contentNonceStart: UInt8
  let aad: String
  let plaintext: String
}

let capabilityFixture = CapabilityFixture(
  linkKeyStart: 0x91,
  serverKeyStart: 0xB3,
  contentKeyStart: 0xD5,
  shareIdStart: 0xF0,
  wrapNonceStart: 0x6E,
  contentNonceStart: 0x8C,
  aad: "patientscribe/capability_check_v1/aad",
  plaintext: "patientscribe/capability_check_v1/plaintext"
)

/// A share whose key is derived under one identifier and whose authenticated
/// data names another.
///
/// Both identifiers are canonical 22-character unpadded base64url, so neither is
/// refused by anything that reads an identifier. The share decrypts cleanly: the
/// tag covers the authenticated data as it stands, and the authenticated data is
/// exactly what was sealed. Everything a reader checks before it compares the
/// two identifiers therefore passes.
///
/// What must refuse it is the comparison itself, made after the tag has
/// verified: the identifier the link carried, encoded, against the identifier
/// inside the authenticated data. A reader that never makes that comparison
/// renders these as though they were the share the link named, and no other
/// vector in this file can tell it apart from one that does.
struct Mismatch {
  let name: String
  let note: String
  let linkKeyStart: UInt8
  let serverKeyStart: UInt8
  let contentKeyStart: UInt8
  let wrapNonceStart: UInt8
  let contentNonceStart: UInt8
  /// The identifier the link carries and the key is derived under.
  let salt: Data
  /// The identifier inside the authenticated data, written from the salt's.
  let sealedIdentifier: (String) -> String
  let exp: Int
  let sfv: String
}

/// The document every mismatch is sealed over.
///
/// A share that would render if the comparison did not refuse it, so that what
/// these vectors put to a reader is the comparison and not a document it would
/// have refused anyway.
let mismatchPlaintext =
  #"{"schema":"share_doc_v1","banner_key":"relay_banner_shared_v1","banner_text":"Example banner text.","you_means":"Example Name","edited":false,"visit_date":"2026-08-14","topic":"Example topic","sections":[{"heading":"Example heading","lines":["Example line one."]}]}"#

let mismatches: [Mismatch] = [
  Mismatch(
    name: "identifier-from-another-share",
    note:
      "The authenticated data names the identifier of a different share entirely. Both identifiers are canonical; the key is derived under the link's, and the tag covers the other one.",
    linkKeyStart: 0x1B,
    serverKeyStart: 0x3D,
    contentKeyStart: 0x5F,
    wrapNonceStart: 0x71,
    contentNonceStart: 0x93,
    salt: patternBytes(start: 0xE0, count: 16),
    sealedIdentifier: { _ in "AAECAwQFBgcICQoLDA0ODw" },
    exp: 1_785_628_800,
    sfv: "1"
  ),
  Mismatch(
    name: "identifier-differs-by-one-character",
    note:
      "The two identifiers differ in a single character, in a position where a canonical encoding may carry any character of the alphabet. A comparison that read a prefix, a suffix, or a length would admit this one.",
    linkKeyStart: 0x2C,
    serverKeyStart: 0x4E,
    contentKeyStart: 0x60,
    wrapNonceStart: 0x82,
    contentNonceStart: 0xA4,
    salt: patternBytes(start: 0x07, count: 16),
    sealedIdentifier: { salt in
      // The first character, moved one place along the alphabet. The final
      // character is the one whose spelling is constrained by the bits it
      // carries, and this is nowhere near it.
      let alphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
      var characters = Array(salt)
      let first = characters[0]
      let at = alphabet.firstIndex(of: first) ?? 0
      characters[0] = alphabet[(at + 1) % alphabet.count]
      return String(characters)
    },
    exp: 1_788_307_200,
    sfv: "1"
  ),
  Mismatch(
    name: "identifier-differs-by-the-two-url-safe-characters",
    note:
      "The two identifiers differ only where the url-safe alphabet parts company with the standard one: every `-` in the link's identifier is a `_` in the sealed one and every `_` is a `-`. A comparison made after decoding through a lenient decoder — one that accepts either alphabet — calls these two the same identifier.",
    linkKeyStart: 0x3E,
    serverKeyStart: 0x50,
    contentKeyStart: 0x72,
    wrapNonceStart: 0x94,
    contentNonceStart: 0xB6,
    // The first three bytes encode as `-__-`, and the thirteen after them are an
    // ordinary counting run, so the substitution below has something to act on
    // and the final character is still one a canonical encoding can end with.
    salt: Data([0xFB, 0xFF, 0xFE]) + patternBytes(start: 0x40, count: 13),
    sealedIdentifier: { salt in
      String(
        salt.map { character in
          character == "-" ? "_" : (character == "_" ? "-" : character)
        })
    },
    exp: 1_790_985_600,
    sfv: "1"
  ),
]

// MARK: - Generation

func buildFixture(_ fixture: Fixture) throws -> JSON {
  let linkKey = patternBytes(start: fixture.linkKeyStart, count: 32)
  let serverKey = patternBytes(start: fixture.serverKeyStart, count: 32)
  let contentKey = patternBytes(start: fixture.contentKeyStart, count: 32)
  let shareId = patternBytes(start: fixture.shareIdStart, count: 16)
  let wrapNonce = patternBytes(start: fixture.wrapNonceStart, count: 12)
  let contentNonce = patternBytes(start: fixture.contentNonceStart, count: 12)

  let canonicalAad = try canonical(fixture.aad)
  guard sameCodeUnits(canonicalAad, fixture.expectedAad) else {
    throw GeneratorError.pinMismatch(
      what: "canonical form of \(fixture.name)",
      produced: canonicalAad,
      pinned: fixture.expectedAad
    )
  }

  // What is sealed is the canonical form, and that string is what travels as
  // `inputs.aad`. The two are one value here rather than two so that no fixture
  // can be sealed over anything but the form the protocol names.
  let aadText = canonicalAad

  let identifierInAad = base64url(shareId)
  guard aadText.contains("\"id\":\"\(identifierInAad)\"") else {
    throw GeneratorError.malformed(
      "fixture \(fixture.name) names an identifier its bytes do not encode to (\(identifierInAad))"
    )
  }

  let kek = deriveKek(linkKey: linkKey, serverKey: serverKey, shareId: shareId)
  let wrapped = try seal(contentKey, using: kek, nonce: wrapNonce, aad: nil)
  let ciphertext = try seal(
    Data(fixture.plaintext.utf8),
    using: SymmetricKey(data: contentKey),
    nonce: contentNonce,
    aad: Data(aadText.utf8)
  )

  guard wrapped.count == 80 else {
    throw GeneratorError.malformed("wrapped content key is \(wrapped.count) characters, not 80")
  }

  return .object([
    ("name", .string(fixture.name)),
    ("note", .string(fixture.note)),
    (
      "inputs",
      .object([
        ("a", .string(base64url(linkKey))),
        ("b", .string(base64url(serverKey))),
        ("id", .string(base64url(shareId))),
        ("k", .string(base64url(contentKey))),
        ("wrap_nonce", .string(base64url(wrapNonce))),
        ("content_nonce", .string(base64url(contentNonce))),
        ("aad", .string(aadText)),
        ("plaintext", .string(fixture.plaintext)),
      ])
    ),
    ("derived", .object([("kek", .string(base64url(kek.withUnsafeBytes { Data($0) })))])),
    (
      "outputs",
      .object([
        ("wrapped_k", .string(wrapped)),
        ("ciphertext", .string(ciphertext)),
        ("fragment", .string("#v=link_split_v1&id=\(base64url(shareId))&a=\(base64url(linkKey))")),
      ])
    ),
  ])
}

func buildDerivation(_ derivation: Derivation) throws -> JSON {
  let linkKey = derivation.linkKey
  let serverKey = derivation.serverKey
  let shareId = derivation.shareId
  let probeKey = derivation.probeKey
  let probeNonce = derivation.probeNonce

  guard linkKey.count == 32, serverKey.count == 32, shareId.count == 16, probeKey.count == 32,
    probeNonce.count == 12
  else {
    throw GeneratorError.malformed("derivation \(derivation.name) has a value of the wrong length")
  }

  let kek = deriveKek(linkKey: linkKey, serverKey: serverKey, shareId: shareId)
  let probe = try seal(probeKey, using: kek, nonce: probeNonce, aad: nil)

  return .object([
    ("name", .string(derivation.name)),
    ("note", .string(derivation.note)),
    (
      "inputs",
      .object([
        ("a", .string(base64url(linkKey))),
        ("b", .string(base64url(serverKey))),
        ("id", .string(base64url(shareId))),
        ("info", .string("patientscribe/link_split_v1/kek")),
        ("output_bytes", .int(32)),
      ])
    ),
    ("derived", .object([("kek", .string(base64url(kek.withUnsafeBytes { Data($0) })))])),
    (
      "probe",
      .object([
        ("k", .string(base64url(probeKey))),
        ("nonce", .string(base64url(probeNonce))),
        ("wrapped_k", .string(probe)),
      ])
    ),
  ])
}

/// One canonicalisation record: the input, the string it must produce, and the
/// string this generator did produce.
///
/// The input is emitted, and it is the member these records were missing. What
/// they carried was `canonical` and `expected`, which are the same string in
/// every entry by construction — the generator refuses to write a file in which
/// they differ — so a reader had two copies of an answer and no question. These
/// vectors are published as a conformance target, and the side of this protocol
/// that has to canonicalise is the producing side: an implementer of it needs
/// the value to canonicalise, not two spellings of what canonicalising it comes
/// to. The value is written as JSON with its members in the order this file
/// wrote them, which is what makes the first record — the same members in a
/// different order — say anything at all.
func buildCanonicalisation(_ item: Canonicalisation) throws -> JSON {
  let produced = try canonical(item.value)
  guard sameCodeUnits(produced, item.expected) else {
    throw GeneratorError.pinMismatch(what: "canonicalisation \(item.name)", produced: produced, pinned: item.expected)
  }
  return .object([
    ("name", .string(item.name)),
    ("note", .string(item.note)),
    ("input", item.value),
    ("canonical", .string(produced)),
    ("expected", .string(item.expected)),
  ])
}

/// Is this exactly the canonical unpadded base64url spelling of sixteen bytes?
///
/// Three things, and the third is the one a length check misses. Twenty-two
/// characters is the only length that carries sixteen bytes; every character has
/// to be in the url-safe alphabet; and the last character carries two bits of
/// the final byte and four bits of nothing, so only the four characters whose
/// value has no low bits can end a canonical encoding. An identifier ending
/// anywhere else decodes to the same bytes and is a second spelling of them,
/// which is exactly what a strict reader refuses — and a vector built out of one
/// would be refused for its spelling rather than for the thing it is about.
func isCanonicalIdentifier(_ text: String) -> Bool {
  let alphabet = Set("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_")
  let characters = Array(text)
  guard characters.count == 22 else { return false }
  guard characters.allSatisfy({ alphabet.contains($0) }) else { return false }
  return "AQgw".contains(characters[21])
}

func buildCapability(_ item: CapabilityFixture) throws -> JSON {
  let linkKey = patternBytes(start: item.linkKeyStart, count: 32)
  let serverKey = patternBytes(start: item.serverKeyStart, count: 32)
  let contentKey = patternBytes(start: item.contentKeyStart, count: 32)
  let shareId = patternBytes(start: item.shareIdStart, count: 16)
  let wrapNonce = patternBytes(start: item.wrapNonceStart, count: 12)
  let contentNonce = patternBytes(start: item.contentNonceStart, count: 12)

  // The whole point of the probe is that the additional data reaches the tag,
  // and an empty string proves nothing about that.
  guard !item.aad.isEmpty else {
    throw GeneratorError.malformed("the capability probe has no authenticated data, so it cannot show that any is used")
  }
  guard !item.plaintext.isEmpty else {
    throw GeneratorError.malformed("the capability probe has no plaintext, so there is nothing for a reader to compare")
  }

  let kek = deriveKek(linkKey: linkKey, serverKey: serverKey, shareId: shareId)
  let wrapped = try seal(contentKey, using: kek, nonce: wrapNonce, aad: nil)
  let ciphertext = try seal(
    Data(item.plaintext.utf8),
    using: SymmetricKey(data: contentKey),
    nonce: contentNonce,
    aad: Data(item.aad.utf8)
  )

  guard wrapped.count == 80 else {
    throw GeneratorError.malformed("the capability probe's wrapped key is \(wrapped.count) characters, not 80")
  }

  return .object([
    ("a", .string(base64url(linkKey))),
    ("b", .string(base64url(serverKey))),
    ("id", .string(base64url(shareId))),
    ("wrapped_k", .string(wrapped)),
    ("ciphertext", .string(ciphertext)),
    ("aad", .string(item.aad)),
    ("plaintext", .string(item.plaintext)),
  ])
}

func buildMismatch(_ item: Mismatch) throws -> JSON {
  guard item.salt.count == 16 else {
    throw GeneratorError.malformed("mismatch \(item.name) has a salt of \(item.salt.count) bytes, not 16")
  }

  let linkKey = patternBytes(start: item.linkKeyStart, count: 32)
  let serverKey = patternBytes(start: item.serverKeyStart, count: 32)
  let contentKey = patternBytes(start: item.contentKeyStart, count: 32)
  let wrapNonce = patternBytes(start: item.wrapNonceStart, count: 12)
  let contentNonce = patternBytes(start: item.contentNonceStart, count: 12)

  let linkIdentifier = base64url(item.salt)
  let sealedIdentifier = item.sealedIdentifier(linkIdentifier)

  guard isCanonicalIdentifier(linkIdentifier), isCanonicalIdentifier(sealedIdentifier) else {
    throw GeneratorError.malformed(
      "mismatch \(item.name) names an identifier that is not a canonical 22-character encoding (\(linkIdentifier), \(sealedIdentifier))"
    )
  }
  guard !sameCodeUnits(linkIdentifier, sealedIdentifier) else {
    throw GeneratorError.malformed("mismatch \(item.name) seals the identifier its own link carries, so nothing is mismatched")
  }

  let aadValue = JSON.object([
    ("v", .string("link_split_v1")),
    ("id", .string(sealedIdentifier)),
    ("doc", .string("share_doc_v1")),
    ("exp", .int(item.exp)),
    ("edited", .bool(false)),
    ("sfv", .string(item.sfv)),
  ])
  let aadText = try canonical(aadValue)

  let kek = deriveKek(linkKey: linkKey, serverKey: serverKey, shareId: item.salt)
  let wrapped = try seal(contentKey, using: kek, nonce: wrapNonce, aad: nil)
  let ciphertext = try seal(
    Data(mismatchPlaintext.utf8),
    using: SymmetricKey(data: contentKey),
    nonce: contentNonce,
    aad: Data(aadText.utf8)
  )

  guard wrapped.count == 80 else {
    throw GeneratorError.malformed("mismatch \(item.name)'s wrapped key is \(wrapped.count) characters, not 80")
  }

  return .object([
    ("name", .string(item.name)),
    ("note", .string(item.note)),
    (
      "inputs",
      .object([
        ("a", .string(base64url(linkKey))),
        ("b", .string(base64url(serverKey))),
        ("id", .string(linkIdentifier)),
        ("aad_id", .string(sealedIdentifier)),
        ("aad", .string(aadText)),
        ("plaintext", .string(mismatchPlaintext)),
      ])
    ),
    ("outputs", .object([("wrapped_k", .string(wrapped)), ("ciphertext", .string(ciphertext))])),
  ])
}

do {
  try checkMemberNameGuard()

  let document = JSON.object([
    (
      "note",
      .string(
        "Interop vectors for the share link scheme. Every key, nonce and identifier here is a fixed counting pattern or constant run written into the generator; none of it came from a real share and none of it protects anything. In each canonicalisation record, `input` is the question and `expected` is the answer to check against; `canonical` is what this generator produced for it and is the same string as `expected` in every record by construction, because the generator refuses to write a file in which the two differ. Three of the four canonicalisation inputs are values chosen to exercise one rule of the form and are not documents this protocol accepts — each record says so. Regenerate with: swift test/vectors/GenerateVectors.swift"
      )
    ),
    (
      "scheme",
      .object([
        ("kek", .string("HKDF-SHA-256(ikm = a || b, salt = id, info = \"patientscribe/link_split_v1/kek\", 32 bytes)")),
        ("wrapped_k", .string("AES-256-GCM(kek, k) with no additional authenticated data")),
        ("ciphertext", .string("AES-256-GCM(k, plaintext) authenticating the aad string's UTF-8 bytes")),
        ("wire", .string("nonce || ciphertext || tag, unpadded base64url; 96-bit nonce, 128-bit tag")),
      ])
    ),
    ("fixtures", .array(try fixtures.map(buildFixture))),
    ("derivations", .array(try derivations.map(buildDerivation))),
    ("canonicalisations", .array(try canonicalisations.map(buildCanonicalisation))),
    ("capability", try buildCapability(capabilityFixture)),
    ("mismatches", .array(try mismatches.map(buildMismatch))),
  ])

  let output = try pretty(document) + "\n"
  let target = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
    .appendingPathComponent("vectors.json")
  try output.write(to: target, atomically: true, encoding: .utf8)

  print(
    "GenerateVectors — wrote \(target.path): "
      + "\(fixtures.count) fixtures, \(derivations.count) derivations, \(canonicalisations.count) canonicalisations, "
      + "1 capability probe, \(mismatches.count) identifier mismatches"
  )
} catch {
  FileHandle.standardError.write(Data("GenerateVectors — failed: \(error)\n".utf8))
  exit(1)
}
