# SPDX-License-Identifier: Apache-2.0
# 使用系统 Windows Hello，只返回状态，不读取或输出 PIN、密码或凭据。
param(
  [Parameter(Mandatory = $true)][string]$WindowHandle,
  [Parameter(Mandatory = $true)][string]$MessageBase64
)
$ErrorActionPreference = 'Stop'
try {
  if ($MessageBase64.Length -gt 4096) { throw 'invalid-message' }
  $owner = [IntPtr]::new([long]::Parse($WindowHandle))
  if ($owner -eq [IntPtr]::Zero) { throw 'invalid-owner' }
  $message = [System.Text.Encoding]::UTF8.GetString([Convert]::FromBase64String($MessageBase64))
  Add-Type -AssemblyName System.Runtime.WindowsRuntime
  $verifierType = [Windows.Security.Credentials.UI.UserConsentVerifier,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
  $availabilityType = [Windows.Security.Credentials.UI.UserConsentVerifierAvailability,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
  $resultType = [Windows.Security.Credentials.UI.UserConsentVerificationResult,Windows.Security.Credentials.UI,ContentType=WindowsRuntime]
  $asTask = $null
  foreach ($method in [System.WindowsRuntimeSystemExtensions].GetMethods()) {
    $parameters = $method.GetParameters()
    if ($method.Name -eq 'AsTask' -and $method.IsGenericMethodDefinition -and $parameters.Length -eq 1 -and $parameters[0].ParameterType.Name -eq 'IAsyncOperation`1') { $asTask = $method; break }
  }
  if ($null -eq $asTask) { throw 'async-unavailable' }
  function Wait-Operation($operation, [Type]$type) {
    $task = $asTask.MakeGenericMethod($type).Invoke($null, @($operation))
    return $task.GetAwaiter().GetResult()
  }
  $availability = Wait-Operation ([Windows.Security.Credentials.UI.UserConsentVerifier]::CheckAvailabilityAsync()) $availabilityType
  if ($availability.ToString() -ne 'Available') {
    [Console]::WriteLine('{"status":"Unavailable"}')
    exit 0
  }
  # 桌面应用以 HWND 调用 WinRT interop；未能绑定原窗口时失败关闭。
  Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
[ComImport, Guid("39E050C3-4E74-441A-8DC0-B81104DF949C"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
public interface IUserConsentVerifierInterop {
    [PreserveSig]
    int RequestVerificationForWindowAsync(IntPtr appWindow, [MarshalAs(UnmanagedType.HString)] string message, ref Guid iid, [MarshalAs(UnmanagedType.Interface)] out object operation);
}
public static class DesktopHello {
    [DllImport("combase.dll", ExactSpelling = true, CharSet = CharSet.Unicode)]
    private static extern int WindowsCreateString(string source, uint length, out IntPtr value);
    [DllImport("combase.dll", ExactSpelling = true)]
    private static extern int WindowsDeleteString(IntPtr value);
    [DllImport("combase.dll", ExactSpelling = true)]
    private static extern int RoGetActivationFactory(IntPtr classId, ref Guid iid, out IntPtr factory);
    public static object Request(IntPtr window, string message, Guid operationId) {
        IntPtr classId = IntPtr.Zero;
        IntPtr factory = IntPtr.Zero;
        object wrapper = null;
        try {
            string name = "Windows.Security.Credentials.UI.UserConsentVerifier";
            Marshal.ThrowExceptionForHR(WindowsCreateString(name, (uint)name.Length, out classId));
            Guid interfaceId = typeof(IUserConsentVerifierInterop).GUID;
            Marshal.ThrowExceptionForHR(RoGetActivationFactory(classId, ref interfaceId, out factory));
            wrapper = Marshal.GetObjectForIUnknown(factory);
            object operation;
            Marshal.ThrowExceptionForHR(((IUserConsentVerifierInterop)wrapper).RequestVerificationForWindowAsync(window, message, ref operationId, out operation));
            return operation;
        } finally {
            if (wrapper != null && Marshal.IsComObject(wrapper)) Marshal.ReleaseComObject(wrapper);
            if (factory != IntPtr.Zero) Marshal.Release(factory);
            if (classId != IntPtr.Zero) WindowsDeleteString(classId);
        }
    }
}
'@
  $operationType = $asTask.GetParameters()[0].ParameterType.GetGenericTypeDefinition().MakeGenericType($resultType)
  $operation = [DesktopHello]::Request($owner, $message, $operationType.GUID)
  $result = Wait-Operation $operation $resultType
  if ($result.ToString() -eq 'Verified') { [Console]::WriteLine('{"status":"Verified"}') }
  else { [Console]::WriteLine('{"status":"Canceled"}') }
} catch {
  [Console]::WriteLine('{"status":"Unavailable"}')
}
