"""Explicit taskbar identity and pin/relaunch metadata for the Python-hosted app."""
import ctypes
from ctypes import wintypes
from pathlib import Path
import subprocess
import sys
import uuid

APP_ID = 'Ajde.LearningApp.Desktop'


class GUID(ctypes.Structure):
    _fields_ = [('data', ctypes.c_ubyte * 16)]

    @classmethod
    def parse(cls, text):
        return cls((ctypes.c_ubyte * 16).from_buffer_copy(uuid.UUID(text).bytes_le))


class PROPERTYKEY(ctypes.Structure):
    _fields_ = [('fmtid', GUID), ('pid', wintypes.DWORD)]


class VariantValue(ctypes.Union):
    _fields_ = [('text', ctypes.c_wchar_p), ('padding', ctypes.c_ubyte * 16)]


class PROPVARIANT(ctypes.Structure):
    _fields_ = [('vt', ctypes.c_ushort), ('reserved', ctypes.c_ushort * 3), ('value', VariantValue)]


def configure_window(hwnd, root):
    """Set all relaunch fields before the window-level AppUserModelID."""
    shell = ctypes.WinDLL('shell32')
    ole = ctypes.OleDLL('ole32')
    initialized = ole.CoInitialize(None)
    store = ctypes.c_void_p()
    iid = GUID.parse('886D8EEB-8CF2-4446-8D02-CDBA1DBDCF99')
    get_store = shell.SHGetPropertyStoreForWindow
    get_store.argtypes = [wintypes.HWND, ctypes.POINTER(GUID), ctypes.POINTER(ctypes.c_void_p)]
    get_store.restype = ctypes.c_long
    try:
        result = get_store(hwnd, ctypes.byref(iid), ctypes.byref(store))
        if result < 0:
            raise OSError(f'SHGetPropertyStoreForWindow failed: {result}')
        table = ctypes.cast(store, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
        set_value = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p, ctypes.POINTER(PROPERTYKEY), ctypes.POINTER(PROPVARIANT))(table[6])
        commit = ctypes.WINFUNCTYPE(ctypes.c_long, ctypes.c_void_p)(table[7])
        root = Path(root)
        executable = Path(sys.executable).with_name('pythonw.exe')
        fields = {
            2: subprocess.list2cmdline([str(executable), str(root / 'desktop.py')]),
            3: str(root / 'assets' / 'ajde.ico') + ',0',
            4: 'Ajde.',
            5: APP_ID,
        }
        for pid, text in fields.items():
            key = PROPERTYKEY(GUID.parse('9F4C2855-9F79-4B39-A8D0-E1D42DE1D5F3'), pid)
            value = PROPVARIANT()
            value.vt = 31  # VT_LPWSTR; Python retains the string for the synchronous call.
            value.value.text = text
            result = set_value(store, ctypes.byref(key), ctypes.byref(value))
            if result < 0:
                raise OSError(f'Taskbar property {pid} failed: {result}')
        if commit(store) < 0:
            raise OSError('Taskbar property commit failed')
    finally:
        if store.value:
            table = ctypes.cast(store, ctypes.POINTER(ctypes.POINTER(ctypes.c_void_p))).contents
            ctypes.WINFUNCTYPE(ctypes.c_ulong, ctypes.c_void_p)(table[2])(store)
        if initialized in (0, 1):
            ole.CoUninitialize()
