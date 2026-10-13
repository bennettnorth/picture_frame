#!/bin/sh
# Adds modern root certificates (Let's Encrypt, Google Trust Services, SSL.com) to the frame's
# Android 6 trust store so its WebView can load HTTPS sites such as a Render or Cloudflare URL.
# Needs root ADB (see docs/ROOTING-PF1007.md). Run from the repo root on your computer:
#
#   sh scripts/install-frame-certs.sh            # install
#   sh scripts/install-frame-certs.sh --undo     # remove exactly what was installed
#
# Pass ADB="adb -s <ip>:5555" to target a frame over Wi-Fi.
set -eu
ADB=${ADB:-adb}
DIR=frame-certs
DEST=/system/etc/security/cacerts
LOG=/data/local/frame-certs-installed  # what we added, so --undo never removes stock certs

[ "$($ADB shell id -u | tr -d '\r')" = 0 ] || { echo "adb shell is not root; root the frame first"; exit 1; }

# Check every certificate against the pinned fingerprints before touching the frame.
while read -r want file; do
  got=$(openssl x509 -in "$DIR/$file" -noout -fingerprint -sha256 | cut -d= -f2 | tr -d : | tr 'A-F' 'a-f')
  [ "$got" = "$want" ] || { echo "Fingerprint mismatch for $file; stopping"; exit 1; }
done < "$DIR/SHA256FINGERPRINTS"

$ADB shell mount -o remount,rw /system
# Read the list on fd 3: adb shell would otherwise swallow the loop's stdin.
while read -r _ file <&3; do
  # Android 6 names trust-store files by OpenSSL's old subject hash.
  name=$(openssl x509 -in "$DIR/$file" -noout -subject_hash_old).0
  if [ "${1:-}" = --undo ]; then
    if [ -n "$($ADB shell "grep -qx $name $LOG 2>/dev/null && echo yes" | tr -d '\r')" ]; then
      $ADB shell rm -f "$DEST/$name"
      echo "removed $name ($file)"
    fi
  elif [ -n "$($ADB shell "[ -e $DEST/$name ] && echo yes" | tr -d '\r')" ]; then
    echo "skip   $name ($file): already present"
  else
    $ADB push "$DIR/$file" "/data/local/tmp/$name" >/dev/null
    $ADB shell "cp /data/local/tmp/$name $DEST/$name && chmod 644 $DEST/$name && chown root:root $DEST/$name && rm /data/local/tmp/$name && echo $name >> $LOG"
    echo "added  $name ($file)"
  fi
done 3< "$DIR/SHA256FINGERPRINTS"
[ "${1:-}" = --undo ] && $ADB shell rm -f $LOG
$ADB shell sync
$ADB shell mount -o remount,ro /system
echo "Done. Power-cycle the frame so apps pick up the new trust store."
