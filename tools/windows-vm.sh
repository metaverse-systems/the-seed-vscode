#!/usr/bin/env bash
# A Windows 11 virtual machine for testing the extension by hand.
#
# Runs the Windows 11 Enterprise evaluation (90 days, from Microsoft's
# Evaluation Center) under QEMU with KVM, UEFI with Secure Boot keys, a
# software TPM and a SATA disk, so Windows installs without extra drivers.
#
#   tools/windows-vm.sh download            fetch the Windows and driver ISOs
#   tools/windows-vm.sh install             create the disk and boot the installer
#   tools/windows-vm.sh start               boot the installed machine
#   tools/windows-vm.sh share [DIR]         serve DIR to the guest over HTTP
#   tools/windows-vm.sh snapshot NAME       save the disk state under NAME
#   tools/windows-vm.sh restore NAME        return the disk to NAME
#   tools/windows-vm.sh snapshots           list saved states
#   tools/windows-vm.sh destroy             delete the machine (keeps the ISOs)
#
# Settings, as environment variables:
#   VM_DIR     where the machine lives   (default ~/.local/share/the-seed-vscode-vm)
#   MEMORY     guest memory              (default 8G)
#   CPUS       guest processors          (default 4)
#   DISK       disk size at creation     (default 80G)
#   WINDOWS_ISO  a Windows ISO to use instead of the downloaded one
#   SHARE_PORT   port of the HTTP share   (default 8765)
#   DISPLAY_MODE QEMU display (default gtk; "none" for a headless run reached over RDP)
#   DRY_RUN=1    print the QEMU command instead of running it
#
# Inside the guest the host is 10.0.2.2, so a share started with
# "share" is at http://10.0.2.2:8765/. Remote Desktop, once enabled in
# Windows, is on the host at localhost:3389.
#
# Needs: qemu-system-x86_64, qemu-img, swtpm, curl, python3, /dev/kvm and
# the OVMF firmware (Debian package ovmf).

set -euo pipefail

VM_DIR="${VM_DIR:-$HOME/.local/share/the-seed-vscode-vm}"
MEMORY="${MEMORY:-8G}"
CPUS="${CPUS:-4}"
DISK="${DISK:-80G}"
SHARE_PORT="${SHARE_PORT:-8765}"
DISPLAY_MODE="${DISPLAY_MODE:-gtk}"

# Windows 11 Enterprise evaluation, 24H2, x64, English. This is the
# Evaluation Center's download link; if it stops resolving to an ISO, take
# the current link from
# https://www.microsoft.com/en-us/evalcenter/evaluate-windows-11-enterprise
# and pass the downloaded file as WINDOWS_ISO.
WINDOWS_URL="https://go.microsoft.com/fwlink/?linkid=2289031"
WINDOWS_ISO="${WINDOWS_ISO:-$VM_DIR/windows-11-enterprise-eval.iso}"

# Guest drivers and tools for QEMU devices (virtio, QXL, the guest agent).
# Not needed to install; useful afterwards for a faster disk and display.
DRIVERS_URL="https://fedorapeople.org/groups/virt/virtio-win/direct-downloads/stable-virtio/virtio-win.iso"
DRIVERS_ISO="$VM_DIR/virtio-win.iso"

OVMF_CODE="/usr/share/OVMF/OVMF_CODE_4M.ms.fd"
OVMF_VARS_TEMPLATE="/usr/share/OVMF/OVMF_VARS_4M.ms.fd"

DISK_IMAGE="$VM_DIR/disk.qcow2"
OVMF_VARS="$VM_DIR/OVMF_VARS.fd"
TPM_DIR="$VM_DIR/tpm"
# Unix socket paths are limited to about 100 bytes, so the control socket
# goes in the runtime directory rather than under VM_DIR.
TPM_SOCKET="${XDG_RUNTIME_DIR:-/tmp}/the-seed-vscode-vm-$(id -u).sock"

die() { echo "windows-vm: $*" >&2; exit 1; }

need() {
  for program in "$@"; do
    command -v "$program" >/dev/null 2>&1 || die "$program is not installed"
  done
}

check_host() {
  need qemu-system-x86_64 qemu-img swtpm
  [ -r /dev/kvm ] && [ -w /dev/kvm ] || die "/dev/kvm is not accessible (is SVM/VT-x enabled in the firmware, and are you in the kvm group?)"
  [ -f "$OVMF_CODE" ] || die "$OVMF_CODE is missing (install the ovmf package)"
  [ -f "$OVMF_VARS_TEMPLATE" ] || die "$OVMF_VARS_TEMPLATE is missing (install the ovmf package)"
}

fetch() {
  local url="$1" target="$2" label="$3"
  need curl
  mkdir -p "$(dirname "$target")"
  echo "Downloading $label to $target"
  # Resumable; Microsoft's server supports ranges.
  curl -L --fail --retry 3 -C - -o "$target" "$url"
  local kind
  kind="$(file -b "$target" 2>/dev/null || true)"
  case "$kind" in
    *ISO\ 9660*|*UDF*|*DOS/MBR\ boot\ sector*) ;;
    *) die "$target is not an ISO image ($kind); the download link may have changed, see the comment at the top of this script" ;;
  esac
  echo "Done: $(du -h "$target" | cut -f1) $label"
}

cmd_download() {
  if [ -f "$WINDOWS_ISO" ] && [ -z "${REDOWNLOAD:-}" ]; then
    echo "Windows ISO already present: $WINDOWS_ISO (set REDOWNLOAD=1 to fetch again)"
  else
    fetch "$WINDOWS_URL" "$WINDOWS_ISO" "Windows 11 Enterprise evaluation"
  fi
  if [ -f "$DRIVERS_ISO" ] && [ -z "${REDOWNLOAD:-}" ]; then
    echo "Driver ISO already present: $DRIVERS_ISO"
  else
    fetch "$DRIVERS_URL" "$DRIVERS_ISO" "virtio-win guest drivers"
  fi
}

start_tpm() {
  mkdir -p "$TPM_DIR"
  swtpm socket --tpm2 --tpmstate "dir=$TPM_DIR" \
    --ctrl "type=unixio,path=$TPM_SOCKET" \
    --log "file=$TPM_DIR/swtpm.log,level=1" --daemon --pid "file=$TPM_DIR/swtpm.pid" \
    || { cat "$TPM_DIR/swtpm.log" >&2; die "swtpm did not start"; }
  # Wait for the control socket.
  for _ in $(seq 1 50); do
    [ -S "$TPM_SOCKET" ] && return 0
    sleep 0.1
  done
  cat "$TPM_DIR/swtpm.log" >&2
  die "swtpm did not start"
}

stop_tpm() {
  if [ -f "$TPM_DIR/swtpm.pid" ]; then
    kill "$(cat "$TPM_DIR/swtpm.pid")" 2>/dev/null || true
    rm -f "$TPM_DIR/swtpm.pid"
  fi
  rm -f "$TPM_SOCKET"
}

run_qemu() {
  # $1 is "install" (boot the CD first) or "start".
  local mode="$1"
  check_host
  [ -f "$DISK_IMAGE" ] || die "no disk at $DISK_IMAGE; run \"$0 install\" first"
  [ -f "$OVMF_VARS" ] || cp "$OVMF_VARS_TEMPLATE" "$OVMF_VARS"

  local -a args=(
    -name "the-seed-vscode Windows 11"
    -machine q35,accel=kvm,smm=on
    -cpu host
    -smp "$CPUS"
    -m "$MEMORY"
    -rtc base=localtime
    -drive "if=pflash,format=raw,readonly=on,file=$OVMF_CODE"
    -drive "if=pflash,format=raw,file=$OVMF_VARS"
    -chardev "socket,id=chrtpm,path=$TPM_SOCKET"
    -tpmdev emulator,id=tpm0,chardev=chrtpm
    -device tpm-tis,tpmdev=tpm0
    # A SATA controller: the Windows installer sees SATA disks and CDs
    # without extra drivers, which virtio devices would need.
    -device ahci,id=ahci
    -drive "file=$DISK_IMAGE,if=none,id=hd0,format=qcow2,discard=unmap"
    -device ide-hd,drive=hd0,bus=ahci.0
    # e1000 is the network card Windows has a driver for out of the box.
    -nic "user,model=e1000,hostfwd=tcp:127.0.0.1:3389-:3389"
    -vga std
    -usb -device usb-tablet
    -display "$DISPLAY_MODE"
  )

  if [ "$mode" = install ]; then
    [ -f "$WINDOWS_ISO" ] || die "no Windows ISO at $WINDOWS_ISO; run \"$0 download\" or set WINDOWS_ISO"
    args+=(
      -drive "file=$WINDOWS_ISO,if=none,id=cd0,media=cdrom,readonly=on"
      -device ide-cd,drive=cd0,bus=ahci.1
      -boot order=d,menu=on
    )
  fi
  if [ -f "$DRIVERS_ISO" ]; then
    args+=(
      -drive "file=$DRIVERS_ISO,if=none,id=cd1,media=cdrom,readonly=on"
      -device ide-cd,drive=cd1,bus=ahci.2
    )
  fi

  if [ -n "${DRY_RUN:-}" ]; then
    printf 'qemu-system-x86_64'
    printf ' %q' "${args[@]}"
    printf '\n'
    return 0
  fi

  start_tpm
  trap stop_tpm EXIT
  if [ "$mode" = install ]; then
    cat <<MSG
Booting the Windows installer. When the window shows "Press any key to boot
from CD or DVD", press a key within a few seconds (otherwise close the window
and run install again). During setup:
  - choose "Custom: Install Windows only" and the single unallocated disk;
  - at the account step, pick "Sign-in options" > "Domain join instead" to
    make a local account without a Microsoft account.
After Windows is installed and the machine has rebooted into it, close the
window and use "$0 start" from then on.
MSG
  fi
  qemu-system-x86_64 "${args[@]}"
}

cmd_install() {
  check_host
  mkdir -p "$VM_DIR"
  if [ -f "$DISK_IMAGE" ]; then
    die "a disk already exists at $DISK_IMAGE; use \"$0 start\", or \"$0 destroy\" to begin again"
  fi
  qemu-img create -f qcow2 "$DISK_IMAGE" "$DISK" >/dev/null
  cp "$OVMF_VARS_TEMPLATE" "$OVMF_VARS"
  echo "Created $DISK_IMAGE ($DISK, grows as used)"
  run_qemu install
}

cmd_start() {
  run_qemu start
}

cmd_share() {
  need python3
  local dir="${1:-$PWD}"
  [ -d "$dir" ] || die "$dir is not a directory"
  echo "Serving $dir to the guest at http://10.0.2.2:$SHARE_PORT/ (Ctrl-C to stop)"
  # Bound to the host's loopback only; the guest reaches it through QEMU's
  # user-mode network, nothing on the LAN can.
  python3 -m http.server --bind 127.0.0.1 --directory "$dir" "$SHARE_PORT"
}

cmd_snapshot() {
  [ -n "${1:-}" ] || die "usage: $0 snapshot NAME"
  [ -f "$DISK_IMAGE" ] || die "no disk at $DISK_IMAGE"
  qemu-img snapshot -c "$1" "$DISK_IMAGE"
  echo "Saved disk state \"$1\" (take snapshots with the machine shut down)"
}

cmd_restore() {
  [ -n "${1:-}" ] || die "usage: $0 restore NAME"
  [ -f "$DISK_IMAGE" ] || die "no disk at $DISK_IMAGE"
  qemu-img snapshot -a "$1" "$DISK_IMAGE"
  echo "Disk returned to \"$1\""
}

cmd_snapshots() {
  [ -f "$DISK_IMAGE" ] || die "no disk at $DISK_IMAGE"
  qemu-img snapshot -l "$DISK_IMAGE"
}

cmd_destroy() {
  stop_tpm
  rm -f "$DISK_IMAGE" "$OVMF_VARS"
  rm -rf "$TPM_DIR"
  echo "Removed the machine's disk, firmware variables and TPM state; the ISOs in $VM_DIR are kept"
}

case "${1:-}" in
  download)  cmd_download ;;
  install)   cmd_install ;;
  start)     cmd_start ;;
  share)     shift; cmd_share "$@" ;;
  snapshot)  shift; cmd_snapshot "$@" ;;
  restore)   shift; cmd_restore "$@" ;;
  snapshots) cmd_snapshots ;;
  destroy)   cmd_destroy ;;
  *)
    sed -n '2,33p' "$0" | sed 's/^# \{0,1\}//'
    exit 1
    ;;
esac
