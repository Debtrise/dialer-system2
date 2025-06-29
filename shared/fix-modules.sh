#!/bin/bash

echo "Fixing Template and Reporting modules addIndex issues..."

# Fix template-models.js
echo "Fixing template-models.js..."
if [ -f template-models.js ]; then
    cp template-models.js template-models.js.backup
    
    # Remove all addIndex calls
    sed -i 's/Template\.addIndex/\/\/ Template\.addIndex/g' template-models.js
    sed -i 's/TransferGroup\.addIndex/\/\/ TransferGroup\.addIndex/g' template-models.js
    sed -i 's/TemplateUsage\.addIndex/\/\/ TemplateUsage\.addIndex/g' template-models.js
    sed -i 's/[A-Za-z]*\.addIndex/\/\/ &/g' template-models.js
fi

# Fix reporting-models.js
echo "Fixing reporting-models.js..."
if [ -f reporting-models.js ]; then
    cp reporting-models.js reporting-models.js.backup
    
    # Remove all addIndex calls - use a more general pattern
    sed -i 's/\([A-Za-z]*\)\.addIndex/\/\/ \1\.addIndex/g' reporting-models.js
fi

echo "Fixes completed!"
