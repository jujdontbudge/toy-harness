import ctypes
import hashlib
import os
import pwd
import re
import sys
from collections.abc import Callable
from typing import Optional

LIMIT = 262144
NOT_FOUND = -25300
DUPLICATE = -25299


class SiwcKeychain:
    def __init__(self) -> None:
        if sys.platform != "darwin":
            raise RuntimeError("siwc_keychain_unavailable")
        owner = pwd.getpwnam("_toy_control")
        if os.getuid() != owner.pw_uid or os.geteuid() != owner.pw_uid:
            raise RuntimeError("siwc_keychain_identity_required")
        self._cf = ctypes.CDLL(
            "/System/Library/Frameworks/CoreFoundation.framework/CoreFoundation"
        )
        self._sec = ctypes.CDLL("/System/Library/Frameworks/Security.framework/Security")
        self._owned: list[ctypes.c_void_p] = []

    def _function(
        self, library: ctypes.CDLL, name: str, result: object, arguments: list[object]
    ) -> Callable[..., object]:
        function = getattr(library, name)
        function.restype = result
        function.argtypes = arguments
        return function

    def _constant(self, library: ctypes.CDLL, name: str) -> ctypes.c_void_p:
        value = ctypes.c_void_p.in_dll(library, name)
        if value.value is None:
            raise RuntimeError("siwc_keychain_unavailable")
        return value

    def _pointer(self, value: object) -> ctypes.c_void_p:
        if not isinstance(value, int) or isinstance(value, bool) or value <= 0:
            raise RuntimeError("siwc_keychain_unavailable")
        pointer = ctypes.c_void_p(value)
        self._owned.append(pointer)
        return pointer

    def _string(self, value: str) -> ctypes.c_void_p:
        create = self._function(
            self._cf, "CFStringCreateWithCString", ctypes.c_void_p,
            [ctypes.c_void_p, ctypes.c_char_p, ctypes.c_uint32],
        )
        return self._pointer(create(None, value.encode("utf-8"), 0x08000100))

    def _data(self, value: bytes) -> ctypes.c_void_p:
        create = self._function(
            self._cf, "CFDataCreate", ctypes.c_void_p,
            [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_long],
        )
        buffer = ctypes.create_string_buffer(value, len(value))
        return self._pointer(create(None, buffer, len(value)))

    def _dictionary(self) -> ctypes.c_void_p:
        create = self._function(
            self._cf, "CFDictionaryCreateMutable", ctypes.c_void_p,
            [ctypes.c_void_p, ctypes.c_long, ctypes.c_void_p, ctypes.c_void_p],
        )
        return self._pointer(create(None, 0, None, None))

    def _set(self, dictionary: ctypes.c_void_p, key: str, value: ctypes.c_void_p) -> None:
        set_value = self._function(
            self._cf, "CFDictionarySetValue", None,
            [ctypes.c_void_p, ctypes.c_void_p, ctypes.c_void_p],
        )
        set_value(dictionary, self._constant(self._sec, key), value)

    def _query(self) -> ctypes.c_void_p:
        query = self._dictionary()
        self._set(query, "kSecClass", self._constant(self._sec, "kSecClassGenericPassword"))
        self._set(query, "kSecAttrService", self._string("toy.siwc-grant-vault.v1"))
        self._set(query, "kSecAttrAccount", self._string("Toy"))
        self._set(query, "kSecAttrSynchronizable", self._constant(self._cf, "kCFBooleanFalse"))
        self._set(query, "kSecUseAuthenticationUI", self._constant(self._sec,
                                                                 "kSecUseAuthenticationUIFail"))
        return query

    def _release(self) -> None:
        release = self._function(self._cf, "CFRelease", None, [ctypes.c_void_p])
        for value in reversed(self._owned):
            release(value)
        self._owned.clear()

    def read(self) -> Optional[bytes]:
        try:
            query = self._query()
            self._set(query, "kSecReturnData", self._constant(self._cf, "kCFBooleanTrue"))
            self._set(query, "kSecMatchLimit", self._constant(self._sec, "kSecMatchLimitOne"))
            result = ctypes.c_void_p()
            copy = self._function(
                self._sec, "SecItemCopyMatching", ctypes.c_int32,
                [ctypes.c_void_p, ctypes.POINTER(ctypes.c_void_p)],
            )
            status = copy(query, ctypes.byref(result))
            if not isinstance(status, int) or isinstance(status, bool):
                raise RuntimeError("siwc_keychain_unavailable")
            if status == NOT_FOUND:
                return None
            if status != 0 or result.value is None:
                raise RuntimeError("siwc_keychain_unavailable")
            self._owned.append(result)
            type_id = self._function(self._cf, "CFGetTypeID", ctypes.c_ulong,
                                     [ctypes.c_void_p])
            data_type_id = self._function(self._cf, "CFDataGetTypeID", ctypes.c_ulong, [])
            if type_id(result) != data_type_id():
                raise RuntimeError("siwc_keychain_invalid")
            length = self._function(self._cf, "CFDataGetLength", ctypes.c_long,
                                    [ctypes.c_void_p])(result)
            if (
                not isinstance(length, int) or isinstance(length, bool)
                or length < 1 or length > LIMIT
            ):
                raise RuntimeError("siwc_keychain_invalid")
            pointer = self._function(self._cf, "CFDataGetBytePtr", ctypes.c_void_p,
                                     [ctypes.c_void_p])(result)
            if not isinstance(pointer, int) or isinstance(pointer, bool) or pointer <= 0:
                raise RuntimeError("siwc_keychain_invalid")
            return ctypes.string_at(pointer, length)
        finally:
            self._release()

    def compare_and_write(self, expected_digest: Optional[str], value: bytes) -> bool:
        if not 0 < len(value) <= LIMIT or expected_digest is not None and not re.fullmatch(
            "[0-9a-f]{64}", expected_digest
        ):
            raise ValueError("siwc_keychain_input_invalid")
        try:
            query = self._query()
            payload = self._data(value)
            digest = self._data(hashlib.sha256(value).digest())
            if expected_digest is None:
                self._set(query, "kSecValueData", payload)
                self._set(query, "kSecAttrGeneric", digest)
                add = self._function(self._sec, "SecItemAdd", ctypes.c_int32,
                                     [ctypes.c_void_p, ctypes.c_void_p])
                status = add(query, None)
                if not isinstance(status, int) or isinstance(status, bool):
                    raise RuntimeError("siwc_keychain_unavailable")
                if status == DUPLICATE:
                    return False
            else:
                self._set(query, "kSecAttrGeneric", self._data(bytes.fromhex(expected_digest)))
                update = self._dictionary()
                self._set(update, "kSecValueData", payload)
                self._set(update, "kSecAttrGeneric", digest)
                write = self._function(self._sec, "SecItemUpdate", ctypes.c_int32,
                                       [ctypes.c_void_p, ctypes.c_void_p])
                status = write(query, update)
                if not isinstance(status, int) or isinstance(status, bool):
                    raise RuntimeError("siwc_keychain_unavailable")
                if status == NOT_FOUND:
                    return False
            if status != 0:
                raise RuntimeError("siwc_keychain_unavailable")
            return True
        finally:
            self._release()


def main() -> int:
    try:
        arguments = sys.argv[1:]
        if arguments == ["read"]:
            stored = SiwcKeychain().read()
            if stored is None:
                return 3
            sys.stdout.buffer.write(stored)
            return 0
        if len(arguments) != 2 or arguments[0] != "write":
            return 2
        expected = None if arguments[1] == "absent" else arguments[1]
        value = sys.stdin.buffer.read(LIMIT + 1)
        return 0 if SiwcKeychain().compare_and_write(expected, value) else 4
    except Exception:
        return 5


if __name__ == "__main__":
    sys.exit(main())
