import CoreFoundation
import CryptoKit
import Darwin
import Foundation
import Security

private let supervisorDeadlineNanoseconds: UInt64 = 12_000_000_000

private func validDigest(_ value: String) -> Bool {
    value.utf8.count == 64 && value.utf8.allSatisfy { (48...57).contains($0) || (97...102).contains($0) }
}

private func validRequest(_ request: NativeSupervisorRequestV1) -> Bool {
    [request.requestId, request.operationId, request.stackId].allSatisfy {
        guard let uuid = Foundation.UUID(uuidString: $0) else { return false }
        return uuid.uuidString.lowercased() == $0
    } && [request.schemaDigest, request.nativeBuildDigest, request.artifacts.parent,
        request.artifacts.child, request.artifacts.supervisor].allSatisfy(validDigest)
        && UInt64(request.generation).map { String($0) == request.generation } == true
}

private func executableDigest(_ path: String) -> String? {
    let descriptor = open(path, O_RDONLY | O_NOFOLLOW | O_CLOEXEC)
    guard descriptor >= 0 else { return nil }
    defer { _ = Darwin.close(descriptor) }
    var info = stat()
    guard fstat(descriptor, &info) == 0, info.st_mode & S_IFMT == S_IFREG,
        info.st_uid == geteuid(), info.st_mode & 0o022 == 0,
        info.st_size > 0, info.st_size <= 32 * 1024 * 1024 else { return nil }
    var hash = SHA256()
    var buffer = [UInt8](repeating: 0, count: 65536)
    var count: Int64 = 0
    while true {
        let received = Darwin.read(descriptor, &buffer, buffer.count)
        if received < 0 {
            if errno == EINTR { continue }
            return nil
        }
        if received == 0 { break }
        count += Int64(received)
        guard count <= info.st_size else { return nil }
        hash.update(data: Data(buffer.prefix(received)))
    }
    var after = stat()
    guard fstat(descriptor, &after) == 0, count == info.st_size,
        after.st_dev == info.st_dev, after.st_ino == info.st_ino, after.st_size == info.st_size,
        after.st_mtimespec.tv_sec == info.st_mtimespec.tv_sec,
        after.st_mtimespec.tv_nsec == info.st_mtimespec.tv_nsec,
        after.st_ctimespec.tv_sec == info.st_ctimespec.tv_sec,
        after.st_ctimespec.tv_nsec == info.st_ctimespec.tv_nsec else { return nil }
    return hash.finalize().map { String(format: "%02x", $0) }.joined()
}

private func ownedDirectory(_ path: String) -> Bool {
    var info = stat()
    return lstat(path, &info) == 0 && info.st_mode & S_IFMT == S_IFDIR
        && info.st_uid == geteuid() && info.st_mode & 0o022 == 0
}

private func exactEntitlements(_ dictionary: NSDictionary, role: NativeSignatureObservationV1Role) -> Bool {
    let required: Set<String>
    switch role {
    case .supervisor: required = []
    case .parent: required = ["com.apple.security.app-sandbox"]
    case .child: required = ["com.apple.security.app-sandbox", "com.apple.security.inherit"]
    }
    guard let keys = dictionary.allKeys as? [String], Set(keys) == required else { return false }
    return required.allSatisfy { key in
        guard let value = dictionary[key] as? NSNumber,
            CFGetTypeID(value) == CFBooleanGetTypeID() else { return false }
        return value.boolValue
    }
}

private func signatureObservation(
    path: String, codePath: String, role: NativeSignatureObservationV1Role, identifier: String, digest: String
) -> NativeSignatureObservationV1? {
    guard executableDigest(path) == digest else { return nil }
    var code: SecStaticCode?
    guard SecStaticCodeCreateWithPath(URL(fileURLWithPath: codePath) as CFURL, [], &code) == errSecSuccess,
        let code else { return nil }
    let flags = SecCSFlags(rawValue: kSecCSCheckAllArchitectures | kSecCSCheckNestedCode | kSecCSStrictValidate
        | kSecCSRestrictSymlinks).union(.noNetworkAccess)
    guard SecStaticCodeCheckValidityWithErrors(code, flags, nil, nil) == errSecSuccess else { return nil }
    var signingInfo: CFDictionary?
    guard SecCodeCopySigningInformation(code, SecCSFlags(rawValue: kSecCSSigningInformation), &signingInfo) == errSecSuccess,
        let signingInfo else { return nil }
    let dictionary = signingInfo as NSDictionary
    guard let observedIdentifier = dictionary[kSecCodeInfoIdentifier] as? String, observedIdentifier == identifier,
        dictionary[kSecCodeInfoTeamIdentifier] == nil,
        let flagNumber = dictionary[kSecCodeInfoFlags] as? NSNumber,
        CFGetTypeID(flagNumber) == CFNumberGetTypeID(),
        let codeIdentifier = dictionary[kSecCodeInfoUnique] as? Data, codeIdentifier.count == 20 else { return nil }
    let signatureFlags = flagNumber.uint32Value
    let requiredFlags: SecCodeSignatureFlags = [.adhoc, .runtime]
    let permittedFlags = requiredFlags.union(.libraryValidation)
    guard flagNumber.int64Value >= 0, flagNumber.uint64Value <= UInt64(UInt32.max),
        signatureFlags & requiredFlags.rawValue == requiredFlags.rawValue,
        signatureFlags & ~permittedFlags.rawValue == 0 else { return nil }
    let entitlements: NSDictionary
    if let value = dictionary[kSecCodeInfoEntitlementsDict] {
        guard let entitlementDictionary = value as? NSDictionary else { return nil }
        entitlements = entitlementDictionary
    } else {
        entitlements = NSDictionary()
    }
    guard exactEntitlements(entitlements, role: role), executableDigest(path) == digest else { return nil }
    let profile: NativeSignatureObservationV1EntitlementProfile
    switch role {
    case .supervisor: profile = .none
    case .parent: profile = .appSandbox
    case .child: profile = .appSandboxInherit
    }
    return NativeSignatureObservationV1(
        role: role, identifier: identifier, artifactDigest: digest,
        codeIdentifierHex: codeIdentifier.map { String(format: "%02x", $0) }.joined(),
        signatureFlags: Int64(signatureFlags), adHoc: CliHelpResultOk(), teamIdentifier: ToyNull(),
        hardenedRuntime: CliHelpResultOk(), libraryValidation: CliHelpResultOk(), entitlementProfile: profile
    )
}

private struct SupervisorObservation {
    var signatures = NativeSupervisorReceiptV1Signatures(supervisor: nil, parent: nil, child: nil)
    var entry: NativeEntryReceiptV2?
    var observedParent: NativeProcessIdentityV1?
    var failure: NativeSupervisorReceiptV1FailureValue?
    var spawnErrno: Int64?
    var exitCode: Int64?
    var signal: Int64?
    var stdoutBytes: Int64 = 0
    var parentReaped = false

    mutating func recordWait(_ outcome: ChildWaitOutcome) {
        switch outcome {
        case .exited(let status):
            parentReaped = true
            let lowBits = status & 0x7f
            if lowBits == 0 { exitCode = Int64((status >> 8) & 0xff) }
            else if lowBits != 0x7f { signal = Int64(lowBits) }
        case .stillOwned, .unavailable:
            failure = .rEAPUNCONFIRMED
        }
    }
}

private func matchesLiveSignature(_ pid: pid_t, expected: NativeSignatureObservationV1) -> Bool {
    let attributes = [kSecGuestAttributePid: NSNumber(value: pid)] as CFDictionary
    var guest: SecCode?
    guard SecCodeCopyGuestWithAttributes(nil, attributes, [], &guest) == errSecSuccess, let guest,
        SecCodeCheckValidity(guest, .noNetworkAccess, nil) == errSecSuccess else { return false }
    var staticCode: SecStaticCode?
    guard SecCodeCopyStaticCode(guest, [], &staticCode) == errSecSuccess, let staticCode else { return false }
    var signingInfo: CFDictionary?
    guard SecCodeCopySigningInformation(staticCode, SecCSFlags(rawValue: kSecCSSigningInformation), &signingInfo) == errSecSuccess,
        let signingInfo else { return false }
    let dictionary = signingInfo as NSDictionary
    guard let identifier = dictionary[kSecCodeInfoIdentifier] as? String, identifier == expected.identifier,
        let unique = dictionary[kSecCodeInfoUnique] as? Data, unique.count == 20,
        dictionary[kSecCodeInfoTeamIdentifier] == nil else { return false }
    return unique.map { String(format: "%02x", $0) }.joined() == expected.codeIdentifierHex
}

private func supervise(request: NativeSupervisorRequestV1, supervisor: NativeProcessIdentityV1) -> SupervisorObservation {
    var result = SupervisorObservation()
    guard let ownPath = executablePath(), URL(fileURLWithPath: ownPath).lastPathComponent == "bootstrap-supervisor" else {
        result.failure = .aRTIFACTMISMATCH
        return result
    }
    let generationRoot = URL(fileURLWithPath: ownPath).deletingLastPathComponent()
    let root = generationRoot.appendingPathComponent("ToyBootstrap.app", isDirectory: true)
    let contents = root.appendingPathComponent("Contents", isDirectory: true)
    let macOS = contents.appendingPathComponent("MacOS", isDirectory: true)
    let helpers = contents.appendingPathComponent("Helpers", isDirectory: true)
    let parentPath = macOS.appendingPathComponent("bootstrap-parent").path
    let childPath = helpers.appendingPathComponent("bootstrap-child").path
    guard root.lastPathComponent == "ToyBootstrap.app",
        [generationRoot.path, root.path, contents.path, macOS.path, helpers.path].allSatisfy(ownedDirectory) else {
        result.failure = .aRTIFACTMISMATCH
        return result
    }
    let parentIdentifier = "net.toy.bootstrap.stack." + request.stackId
    let ownSignature = signatureObservation(path: ownPath, codePath: ownPath, role: .supervisor,
        identifier: "net.toy.bootstrap.supervisor", digest: request.artifacts.supervisor)
    let parentSignature = signatureObservation(path: parentPath, codePath: root.path, role: .parent,
        identifier: parentIdentifier, digest: request.artifacts.parent)
    let childSignature = signatureObservation(path: childPath, codePath: childPath, role: .child,
        identifier: parentIdentifier + ".child", digest: request.artifacts.child)
    result.signatures = NativeSupervisorReceiptV1Signatures(supervisor: ownSignature, parent: parentSignature, child: childSignature)
    guard ownSignature != nil, let parentSignature, childSignature != nil else {
        result.failure = .sIGNATUREINVALID
        return result
    }
    var outputPipe = [Int32](repeating: -1, count: 2)
    var acknowledgmentPipe = [Int32](repeating: -1, count: 2)
    defer {
        for descriptor in outputPipe + acknowledgmentPipe where descriptor >= 0 { _ = Darwin.close(descriptor) }
    }
    guard pipe(&outputPipe) == 0, pipe(&acknowledgmentPipe) == 0 else {
        result.spawnErrno = Int64(errno)
        result.failure = .sPAWNFAILED
        return result
    }
    var ownedDescriptors: [Int32] = []
    defer { for descriptor in ownedDescriptors { _ = Darwin.close(descriptor) } }
    func copyDescriptor(_ source: Int32) -> Int32? {
        guard let copy = duplicateCloseOnExec(source) else { return nil }
        ownedDescriptors.append(copy)
        return copy
    }
    guard let outputReader = copyDescriptor(outputPipe[0]), let outputWriter = copyDescriptor(outputPipe[1]),
        let acknowledgmentReader = copyDescriptor(acknowledgmentPipe[0]),
        let acknowledgmentWriter = copyDescriptor(acknowledgmentPipe[1]) else {
        result.spawnErrno = Int64(errno)
        result.failure = .sPAWNFAILED
        return result
    }
    for index in 0..<2 {
        _ = Darwin.close(outputPipe[index])
        outputPipe[index] = -1
        _ = Darwin.close(acknowledgmentPipe[index])
        acknowledgmentPipe[index] = -1
    }
    guard executableDigest(ownPath) == request.artifacts.supervisor,
        executableDigest(parentPath) == request.artifacts.parent,
        executableDigest(childPath) == request.artifacts.child else {
        result.failure = .aRTIFACTMISMATCH
        return result
    }
    let deadline = deadlineAfter(supervisorDeadlineNanoseconds)
    let spawn = spawnFixedProcess(path: parentPath, role: .parent, descriptors: [
        (source: outputWriter, target: STDOUT_FILENO), (source: acknowledgmentReader, target: 5)
    ])
    let parentPid: pid_t
    switch spawn {
    case .failed(let code):
        result.spawnErrno = Int64(code)
        result.failure = .sPAWNFAILED
        return result
    case .spawned(let pid): parentPid = pid
    }
    let writerClosed = Darwin.close(outputWriter) == 0
    if writerClosed { ownedDescriptors.removeAll { $0 == outputWriter } }
    let acknowledgmentReaderClosed = Darwin.close(acknowledgmentReader) == 0
    if acknowledgmentReaderClosed { ownedDescriptors.removeAll { $0 == acknowledgmentReader } }
    guard writerClosed, acknowledgmentReaderClosed else {
        result.failure = .eNTRYINVALID
        result.recordWait(terminateAndReap(parentPid))
        return result
    }
    let frame = readFrame(from: outputReader, until: deadline)
    let data: Data
    switch frame {
    case .incomplete(let count), .endOfStream(let count):
        result.stdoutBytes = Int64(count)
        result.failure = .eNTRYINVALID
        result.recordWait(terminateAndReap(parentPid))
        return result
    case .timedOut(let count):
        result.stdoutBytes = Int64(count)
        result.failure = .tIMEOUT
        result.recordWait(terminateAndReap(parentPid))
        return result
    case .frame(let bytes, let count):
        data = bytes
        result.stdoutBytes = Int64(count)
    }
    guard let entry = try? JSONDecoder().decode(NativeEntryReceiptV2.self, from: data) else {
        result.failure = .eNTRYINVALID
        result.recordWait(terminateAndReap(parentPid))
        return result
    }
    guard let observed = processIdentity(parentPid), entry.parent.pid == Int64(parentPid),
        entry.parent.parentPid == supervisor.pid, entry.parent.uid == supervisor.uid, entry.parent.gid == supervisor.gid,
        entry.child.pid > 0, entry.child.pid != entry.parent.pid, entry.child.parentPid == entry.parent.pid,
        entry.child.uid == supervisor.uid, entry.child.gid == supervisor.gid,
        UInt64(entry.child.birthSeconds) != nil, (0...999999).contains(entry.child.birthMicroseconds),
        executablePath(for: parentPid) == parentPath,
        sameIdentity(entry.parent, observed), matchesLiveSignature(parentPid, expected: parentSignature),
        let finalIdentity = processIdentity(parentPid), sameIdentity(observed, finalIdentity) else {
        result.failure = .iDENTITYMISMATCH
        result.recordWait(terminateAndReap(parentPid))
        return result
    }
    result.entry = entry
    result.observedParent = observed
    guard emit(Data([0x5a]), to: acknowledgmentWriter) else {
        result.failure = .eNTRYINVALID
        result.recordWait(terminateAndReap(parentPid))
        return result
    }
    guard Darwin.close(acknowledgmentWriter) == 0 else {
        result.failure = .eNTRYINVALID
        result.recordWait(terminateAndReap(parentPid))
        return result
    }
    ownedDescriptors.removeAll { $0 == acknowledgmentWriter }
    switch waitForChild(parentPid, until: deadline) {
    case .stillOwned:
        result.failure = .tIMEOUT
        result.recordWait(terminateAndReap(parentPid))
    case .unavailable:
        result.failure = .rEAPUNCONFIRMED
    case .exited(let status):
        result.recordWait(.exited(status))
        if status != 0 { result.failure = .eNTRYINVALID }
    }
    if result.parentReaped {
        switch readFrame(from: outputReader, until: deadlineAfter(1_000_000_000)) {
        case .endOfStream(let count):
            result.stdoutBytes += Int64(count)
            if count != 0 { result.failure = .eNTRYINVALID }
        case .frame(_, let count), .incomplete(let count), .timedOut(let count):
            result.stdoutBytes += Int64(count)
            result.failure = .eNTRYINVALID
        }
    }
    return result
}

@main
private struct BootstrapSupervisor {
    static func main() {
        _ = Darwin.signal(SIGPIPE, SIG_IGN)
        guard CommandLine.arguments.count == 1, let supervisor = sampleSelfIdentity(),
            case .frame(let bytes, _) = readFrame(from: 3, until: deadlineAfter(5_000_000_000)),
            let request = try? JSONDecoder().decode(NativeSupervisorRequestV1.self, from: bytes), validRequest(request),
            Darwin.close(3) == 0 else {
            _ = emit(Data("BOOTSTRAP_SUPERVISOR_INPUT_INVALID\n".utf8), to: STDERR_FILENO)
            exit(EXIT_FAILURE)
        }
        let observation = supervise(request: request, supervisor: supervisor)
        let receipt = NativeSupervisorReceiptV1(
            protocol: .toyBootstrapSupervisorReceiptV1, requestId: request.requestId, operationId: request.operationId,
            stackId: request.stackId, generation: request.generation, schemaDigest: request.schemaDigest,
            nativeBuildDigest: request.nativeBuildDigest, supervisor: supervisor, signatures: observation.signatures,
            entry: observation.entry, observedParent: observation.observedParent, failure: observation.failure,
            spawnErrno: observation.spawnErrno, exitCode: observation.exitCode, signal: observation.signal,
            stdoutBytes: observation.stdoutBytes, stderrBytes: ToyNull(), parentReaped: observation.parentReaped,
            completeDescendantCleanup: CliFailureOk(), ready: CliFailureOk()
        )
        guard var payload = encoded(receipt), payload.count <= 8192 else { exit(EXIT_FAILURE) }
        payload.append(0x0a)
        guard emit(payload, to: STDOUT_FILENO) else { exit(EXIT_FAILURE) }
        if observation.failure != nil { exit(EXIT_FAILURE) }
    }
}
