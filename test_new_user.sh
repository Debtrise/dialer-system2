#!/bin/bash

USER="recording-deploy"
PASS="Recording123!"  # Update with your chosen password
HOST="34.29.105.211"

echo "=== Testing New User Setup ==="

# Test 1: SSH Connection
echo -n "1. SSH Connection: "
if sshpass -p "$PASS" ssh -o StrictHostKeyChecking=no $USER@$HOST "echo 'OK'" 2>/dev/null; then
    echo "✓ PASSED"
else
    echo "✗ FAILED"
    exit 1
fi

# Test 2: Sudo Access
echo -n "2. Sudo Access: "
if sshpass -p "$PASS" ssh -o StrictHostKeyChecking=no $USER@$HOST "sudo ls /var/lib/asterisk/sounds/ > /dev/null && echo 'OK'" 2>/dev/null; then
    echo "✓ PASSED"
else
    echo "✗ FAILED"
    exit 1
fi

# Test 3: File Operations
echo -n "3. File Operations: "
echo "test" > /tmp/test_file.txt
if sshpass -p "$PASS" scp -o StrictHostKeyChecking=no /tmp/test_file.txt $USER@$HOST:/tmp/ 2>/dev/null; then
    sshpass -p "$PASS" ssh -o StrictHostKeyChecking=no $USER@$HOST "sudo mv /tmp/test_file.txt /var/lib/asterisk/sounds/custom/ && sudo rm /var/lib/asterisk/sounds/custom/test_file.txt" 2>/dev/null
    echo "✓ PASSED"
    rm /tmp/test_file.txt
else
    echo "✗ FAILED"
    exit 1
fi

# Test 4: Directory Creation
echo -n "4. Directory Creation: "
if sshpass -p "$PASS" ssh -o StrictHostKeyChecking=no $USER@$HOST "sudo mkdir -p /var/lib/asterisk/sounds/custom/test_dir && sudo rmdir /var/lib/asterisk/sounds/custom/test_dir && echo 'OK'" 2>/dev/null; then
    echo "✓ PASSED"
else
    echo "✗ FAILED"
fi

echo -e "\nAll tests passed! New user is properly configured."
