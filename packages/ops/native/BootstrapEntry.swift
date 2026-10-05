import Darwin
import Dispatch
import Foundation

private let maximumIdentityBytes = 4096
private let inheritedIdentityDescriptor: Int32 = 3
private let inheritedAcknowledgmentDescriptor: Int32 = 4
private let childDeadlineNanoseconds: UInt64 = 5_000_000_000
private let childAcknowledgment: UInt8 = 0xa5

enum ChildWaitOutcome {
    case exited(Int32)
    case stillOwned
    case unavailable
}

enum NativeFrameReadOutcome {
    case frame(Data, Int)
    case endOfStream(Int)
    case incomplete(Int)
    case timedOut(Int)
}

func emit(_ data: Data, to descriptor: Int32) -> Bool {
    data.withUnsafeBytes { bytes in
        guard let base = bytes.baseAddress else { return false }
        var offset = 0
        while offset < bytes.count {
            let written = Darwin.write(descriptor, base.advanced(by: offset), bytes.count - offset)
            if written < 0 {
                if errno == EINTR { continue }
                return false
            }
            if written == 0 { return false }
            offset += written
        }
        return true
    }
}

private func failure() -> Never {
    _ = emit(Data("BOOTSTRAP_ENTRY_FAILED\n".utf8), to: STDERR_FILENO)
    exit(EXIT_FAILURE)
}

func processIdentity(_ pid: pid_t) -> NativeProcessIdentityV1? {
    var info = proc_bsdinfo()
    let size = Int32(MemoryLayout<proc_bsdinfo>.size)
    guard proc_pidinfo(pid, PROC_PIDTBSDINFO, 0, &info, size) == size,
        info.pbi_pid == UInt32(pid), info.pbi_ruid == info.pbi_uid, info.pbi_rgid == info.pbi_gid,
        info.pbi_start_tvusec <= 999999 else { return nil }
    return NativeProcessIdentityV1(
        pid: Int64(pid),
        parentPid: Int64(info.pbi_ppid),
        uid: Int64(info.pbi_uid),
        gid: Int64(info.pbi_gid),
        birthSeconds: String(info.pbi_start_tvsec),
        birthMicroseconds: Int64(info.pbi_start_tvusec)
    )
}

func sampleSelfIdentity() -> NativeProcessIdentityV1? {
    let realUid = getuid()
    let effectiveUid = geteuid()
    let realGid = getgid()
    let effectiveGid = getegid()
    guard realUid == effectiveUid, realGid == effectiveGid,
        let identity = processIdentity(getpid()),
        identity.parentPid == Int64(getppid()),
        identity.uid == Int64(effectiveUid), identity.gid == Int64(effectiveGid) else { return nil }
    return identity
}

func sameIdentity(_ left: NativeProcessIdentityV1, _ right: NativeProcessIdentityV1) -> Bool {
    left.pid == right.pid && left.parentPid == right.parentPid && left.uid == right.uid && left.gid == right.gid
        && left.birthSeconds == right.birthSeconds && left.birthMicroseconds == right.birthMicroseconds
}

func encoded<T: Encodable>(_ value: T) -> Data? {
    let encoder = JSONEncoder()
    encoder.outputFormatting = [.sortedKeys, .withoutEscapingSlashes]
    return try? encoder.encode(value)
}

#if BOOTSTRAP_CHILD
@main
private struct BootstrapEntry {
    static func main() {
        guard CommandLine.arguments.count == 1, let identity = sampleSelfIdentity(),
            let identityBytes = encoded(identity), identityBytes.count <= maximumIdentityBytes else { failure() }
        var payload = identityBytes
        payload.append(0x0a)
        var acknowledgment: UInt8 = 0
        guard emit(payload, to: inheritedIdentityDescriptor),
            Darwin.read(inheritedAcknowledgmentDescriptor, &acknowledgment, 1) == 1,
            acknowledgment == childAcknowledgment,
            Darwin.close(inheritedIdentityDescriptor) == 0,
            Darwin.close(inheritedAcknowledgmentDescriptor) == 0 else { failure() }
    }
}
#else
func duplicateCloseOnExec(_ descriptor: Int32) -> Int32? {
    let copy = fcntl(descriptor, F_DUPFD_CLOEXEC, 10)
    return copy < 0 ? nil : copy
}

func executablePath(for pid: pid_t = getpid()) -> String? {
    var path = [CChar](repeating: 0, count: 4096)
    let count = proc_pidpath(pid, &path, UInt32(path.count))
    guard count > 0, let terminator = path.firstIndex(of: 0) else { return nil }
    return String(decoding: path[..<terminator].map { UInt8(bitPattern: $0) }, as: UTF8.self)
}

private func fixedChildPath() -> String? {
    guard let path = executablePath() else { return nil }
    let executable = URL(fileURLWithPath: path).standardizedFileURL
    let macOSDirectory = executable.deletingLastPathComponent()
    let contentsDirectory = macOSDirectory.deletingLastPathComponent()
    guard macOSDirectory.lastPathComponent == "MacOS", contentsDirectory.lastPathComponent == "Contents" else { return nil }
    return contentsDirectory.appendingPathComponent("Helpers", isDirectory: true)
        .appendingPathComponent("bootstrap-child", isDirectory: false).path
}

private func monotonicNanoseconds() -> UInt64 {
    DispatchTime.now().uptimeNanoseconds
}

func deadlineAfter(_ duration: UInt64) -> UInt64 {
    let start = monotonicNanoseconds()
    return start <= UInt64.max - duration ? start + duration : UInt64.max
}

func remainingMilliseconds(until deadline: UInt64) -> Int32? {
    let current = monotonicNanoseconds()
    guard current < deadline else { return nil }
    let remaining = deadline - current
    let rounded = remaining / 1_000_000 + (remaining.isMultiple(of: 1_000_000) ? 0 : 1)
    return Int32(min(rounded, UInt64(Int32.max)))
}

func readFrame(from descriptor: Int32, until deadline: UInt64) -> NativeFrameReadOutcome {
    var result = Data()
    var buffer = [UInt8](repeating: 0, count: 512)
    var byteCount = 0
    while true {
        var pollEntry = pollfd(fd: descriptor, events: Int16(POLLIN | POLLHUP), revents: 0)
        guard let remaining = remainingMilliseconds(until: deadline) else { return .timedOut(byteCount) }
        let ready = Darwin.poll(&pollEntry, 1, remaining)
        if ready < 0 {
            if errno == EINTR { continue }
            return .incomplete(byteCount)
        }
        if ready == 0 { return .timedOut(byteCount) }
        let count = Darwin.read(descriptor, &buffer, buffer.count)
        if count < 0 {
            if errno == EINTR { continue }
            return .incomplete(byteCount)
        }
        if count == 0 { return .endOfStream(byteCount) }
        byteCount += count
        let chunk = Data(buffer.prefix(count))
        if let newline = chunk.firstIndex(of: 0x0a) {
            guard newline == chunk.count - 1, result.count + newline <= maximumIdentityBytes else { return .incomplete(byteCount) }
            result.append(contentsOf: chunk[..<newline])
            return result.isEmpty ? .incomplete(byteCount) : .frame(result, byteCount)
        }
        guard result.count + count <= maximumIdentityBytes else { return .incomplete(byteCount) }
        result.append(chunk)
    }
}

func waitForChild(_ child: pid_t, until deadline: UInt64) -> ChildWaitOutcome {
    var status: Int32 = 0
    while true {
        let result = waitpid(child, &status, WNOHANG)
        if result == child { return .exited(status) }
        if result < 0, errno == EINTR { continue }
        if result < 0 { return .unavailable }
        guard remainingMilliseconds(until: deadline) != nil else { return .stillOwned }
        var interval = timespec(tv_sec: 0, tv_nsec: 10_000_000)
        while true {
            var remainder = timespec()
            if nanosleep(&interval, &remainder) == 0 { break }
            if errno != EINTR { return .stillOwned }
            guard remainingMilliseconds(until: deadline) != nil else { return .stillOwned }
            interval = remainder
        }
    }
}

@discardableResult
func terminateAndReap(_ child: pid_t) -> ChildWaitOutcome {
    switch waitForChild(child, until: deadlineAfter(0)) {
    case .exited(let status): return .exited(status)
    case .unavailable: return .unavailable
    case .stillOwned: break
    }
    guard kill(child, SIGKILL) == 0 || errno == ESRCH else { return .stillOwned }
    let cleanupDeadline = deadlineAfter(childDeadlineNanoseconds)
    return waitForChild(child, until: cleanupDeadline)
}

enum NativeSpawnRole: String {
    case parent = "bootstrap-parent"
    case child = "bootstrap-child"
}

enum NativeSpawnOutcome {
    case spawned(pid_t)
    case failed(Int32)
}

func spawnFixedProcess(path: String, role: NativeSpawnRole, descriptors: [(source: Int32, target: Int32)]) -> NativeSpawnOutcome {
    guard descriptors.allSatisfy({ $0.source >= 10 && $0.target >= 0 && $0.target <= 5 }),
        Set(descriptors.map { $0.target }).count == descriptors.count else { return .failed(EINVAL) }
    let nullDescriptor = open("/dev/null", O_RDWR | O_CLOEXEC)
    guard nullDescriptor >= 0 else { return .failed(errno) }
    defer { _ = Darwin.close(nullDescriptor) }
    guard let childNullDescriptor = duplicateCloseOnExec(nullDescriptor) else { return .failed(errno) }
    defer { _ = Darwin.close(childNullDescriptor) }
    var actions: posix_spawn_file_actions_t?
    let actionsStatus = posix_spawn_file_actions_init(&actions)
    guard actionsStatus == 0 else { return .failed(actionsStatus) }
    defer { posix_spawn_file_actions_destroy(&actions) }
    for target in [STDIN_FILENO, STDOUT_FILENO, STDERR_FILENO] {
        let status = posix_spawn_file_actions_adddup2(&actions, childNullDescriptor, target)
        guard status == 0 else { return .failed(status) }
    }
    for descriptor in descriptors {
        let status = posix_spawn_file_actions_adddup2(&actions, descriptor.source, descriptor.target)
        guard status == 0 else { return .failed(status) }
    }
    for descriptor in Set(descriptors.map { $0.source } + [childNullDescriptor]) {
        let status = posix_spawn_file_actions_addclose(&actions, descriptor)
        guard status == 0 else { return .failed(status) }
    }
    var attributes: posix_spawnattr_t?
    let attributeStatus = posix_spawnattr_init(&attributes)
    guard attributeStatus == 0 else { return .failed(attributeStatus) }
    defer { posix_spawnattr_destroy(&attributes) }
    let flagStatus = posix_spawnattr_setflags(&attributes, Int16(POSIX_SPAWN_CLOEXEC_DEFAULT))
    guard flagStatus == 0 else { return .failed(flagStatus) }
    guard let argument = strdup(role.rawValue) else { return .failed(ENOMEM) }
    defer { free(argument) }
    guard let language = strdup("LANG=C") else { return .failed(ENOMEM) }
    defer { free(language) }
    guard let locale = strdup("LC_ALL=C") else { return .failed(ENOMEM) }
    defer { free(locale) }
    guard let searchPath = strdup("PATH=/usr/bin:/bin") else { return .failed(ENOMEM) }
    defer { free(searchPath) }
    var arguments: [UnsafeMutablePointer<CChar>?] = [argument, nil]
    var environment: [UnsafeMutablePointer<CChar>?] = [language, locale, searchPath, nil]
    var child: pid_t = 0
    let spawnStatus = path.withCString { executable in
        arguments.withUnsafeMutableBufferPointer { argumentBuffer in
            environment.withUnsafeMutableBufferPointer { environmentBuffer in
                posix_spawn(&child, executable, &actions, &attributes, argumentBuffer.baseAddress, environmentBuffer.baseAddress)
            }
        }
    }
    guard spawnStatus == 0, child > 0 else { return .failed(spawnStatus == 0 ? ECHILD : spawnStatus) }
    return .spawned(child)
}

private func spawnChild(path: String, parent: NativeProcessIdentityV1) -> NativeProcessIdentityV1? {
    var identityPipe = [Int32](repeating: -1, count: 2)
    var acknowledgmentPipe = [Int32](repeating: -1, count: 2)
    defer {
        for descriptor in identityPipe + acknowledgmentPipe where descriptor >= 0 { _ = Darwin.close(descriptor) }
    }
    guard pipe(&identityPipe) == 0, pipe(&acknowledgmentPipe) == 0 else { return nil }
    guard let parentReadDescriptor = duplicateCloseOnExec(identityPipe[0]) else { return nil }
    var ownedDescriptors = [parentReadDescriptor]
    defer { for descriptor in ownedDescriptors { _ = Darwin.close(descriptor) } }
    guard let childWriteDescriptor = duplicateCloseOnExec(identityPipe[1]) else { return nil }
    ownedDescriptors.append(childWriteDescriptor)
    guard let childReadAcknowledgmentDescriptor = duplicateCloseOnExec(acknowledgmentPipe[0]) else { return nil }
    ownedDescriptors.append(childReadAcknowledgmentDescriptor)
    guard let parentWriteAcknowledgmentDescriptor = duplicateCloseOnExec(acknowledgmentPipe[1]) else { return nil }
    ownedDescriptors.append(parentWriteAcknowledgmentDescriptor)
    for index in 0..<2 {
        _ = Darwin.close(identityPipe[index])
        identityPipe[index] = -1
        _ = Darwin.close(acknowledgmentPipe[index])
        acknowledgmentPipe[index] = -1
    }

    let deadline = deadlineAfter(childDeadlineNanoseconds)
    guard case .spawned(let child) = spawnFixedProcess(path: path, role: .child, descriptors: [
        (source: childWriteDescriptor, target: inheritedIdentityDescriptor),
        (source: childReadAcknowledgmentDescriptor, target: inheritedAcknowledgmentDescriptor)
    ]) else { return nil }
    let childWriterClosed = Darwin.close(childWriteDescriptor) == 0
    if childWriterClosed { ownedDescriptors.removeAll { $0 == childWriteDescriptor } }
    let childAcknowledgmentReaderClosed = Darwin.close(childReadAcknowledgmentDescriptor) == 0
    if childAcknowledgmentReaderClosed { ownedDescriptors.removeAll { $0 == childReadAcknowledgmentDescriptor } }
    guard childWriterClosed, childAcknowledgmentReaderClosed else {
        terminateAndReap(child)
        return nil
    }
    guard case .frame(let childData, _) = readFrame(from: parentReadDescriptor, until: deadline),
        let reportedIdentity = try? JSONDecoder().decode(NativeProcessIdentityV1.self, from: childData),
        let observedIdentity = processIdentity(child),
        reportedIdentity.pid == Int64(child), reportedIdentity.parentPid == parent.pid,
        reportedIdentity.uid == parent.uid, reportedIdentity.gid == parent.gid,
        sameIdentity(reportedIdentity, observedIdentity) else {
        terminateAndReap(child)
        return nil
    }
    guard emit(Data([childAcknowledgment]), to: parentWriteAcknowledgmentDescriptor) else {
        terminateAndReap(child)
        return nil
    }
    guard Darwin.close(parentWriteAcknowledgmentDescriptor) == 0 else {
        terminateAndReap(child)
        return nil
    }
    ownedDescriptors.removeAll { $0 == parentWriteAcknowledgmentDescriptor }
    switch waitForChild(child, until: deadline) {
    case .exited(let status):
        return status == 0 ? reportedIdentity : nil
    case .unavailable:
        return nil
    case .stillOwned:
        terminateAndReap(child)
        return nil
    }
}

#if !BOOTSTRAP_SUPERVISOR
@main
private struct BootstrapEntry {
    static func main() {
        _ = Darwin.signal(SIGPIPE, SIG_IGN)
        guard CommandLine.arguments.count == 1, let parent = sampleSelfIdentity(),
            let childPath = fixedChildPath(), let child = spawnChild(path: childPath, parent: parent) else { failure() }
        let receipt = NativeEntryReceiptV2(
            protocol: .toyBootstrapNativeV2,
            parent: parent,
            child: child,
            entered: CliHelpResultOk(),
            inheritedChildEntered: CliHelpResultOk(),
            containerHomeReady: CliFailureOk()
        )
        guard var payload = encoded(receipt) else { failure() }
        payload.append(0x0a)
        guard emit(payload, to: STDOUT_FILENO) else { failure() }
        var acknowledgment: UInt8 = 0
        var pollEntry = pollfd(fd: 5, events: Int16(POLLIN | POLLHUP), revents: 0)
        guard let remaining = remainingMilliseconds(until: deadlineAfter(childDeadlineNanoseconds)),
            Darwin.poll(&pollEntry, 1, remaining) == 1,
            Darwin.read(5, &acknowledgment, 1) == 1, acknowledgment == 0x5a,
            Darwin.close(5) == 0 else { failure() }
    }
}
#endif
#endif
