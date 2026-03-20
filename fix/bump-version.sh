#!/bin/bash
# bump-version.sh
# Semantic versioning bump with changelog and deployment tracking

set -e

CURRENT_VERSION=$(node -p "require('./package.json').version")
TIMESTAMP=$(date +%Y%m%d_%H%M%S)
DATE=$(date +%Y-%m-%d)

echo "🔢 VERSION BUMP UTILITY"
echo "================================================"
echo "Current Version: $CURRENT_VERSION"
echo ""

# Parse current version
IFS='.' read -ra VERSION_PARTS <<< "$CURRENT_VERSION"
MAJOR=${VERSION_PARTS[0]}
MINOR=${VERSION_PARTS[1]}
PATCH=${VERSION_PARTS[2]}

echo "Select version bump type:"
echo "  1) Patch   ($MAJOR.$MINOR.$((PATCH+1))) - Bug fixes, minor changes"
echo "  2) Minor   ($MAJOR.$((MINOR+1)).0) - New features, backward compatible"
echo "  3) Major   ($((MAJOR+1)).0.0) - Breaking changes"
echo "  4) Custom  - Specify version manually"
echo ""
read -p "Enter choice (1-4): " BUMP_TYPE

case $BUMP_TYPE in
    1)
        NEW_VERSION="$MAJOR.$MINOR.$((PATCH+1))"
        BUMP_NAME="patch"
        ;;
    2)
        NEW_VERSION="$MAJOR.$((MINOR+1)).0"
        BUMP_NAME="minor"
        ;;
    3)
        NEW_VERSION="$((MAJOR+1)).0.0"
        BUMP_NAME="major"
        ;;
    4)
        read -p "Enter new version (e.g., 2.1.0): " NEW_VERSION
        BUMP_NAME="custom"
        ;;
    *)
        echo "❌ Invalid choice"
        exit 1
        ;;
esac

echo ""
echo "New Version: $NEW_VERSION"
echo ""

# Collect changelog information
echo "📝 CHANGELOG INFORMATION"
echo "================================================"
echo "Enter change description (one per line, empty line to finish):"

CHANGES=()
while true; do
    read -p "> " CHANGE
    if [ -z "$CHANGE" ]; then
        break
    fi
    CHANGES+=("$CHANGE")
done

# Collect migration information
echo ""
echo "Database migrations included? (y/n): "
read HAS_MIGRATIONS

MIGRATIONS=()
if [ "$HAS_MIGRATIONS" = "y" ] || [ "$HAS_MIGRATIONS" = "Y" ]; then
    echo "Enter migration filenames (one per line, empty line to finish):"
    while true; do
        read -p "> " MIGRATION
        if [ -z "$MIGRATION" ]; then
            break
        fi
        MIGRATIONS+=("$MIGRATION")
    done
fi

# Display summary
echo ""
echo "================================================"
echo "VERSION BUMP SUMMARY"
echo "================================================"
echo "Current Version: $CURRENT_VERSION"
echo "New Version: $NEW_VERSION"
echo "Bump Type: $BUMP_NAME"
echo "Date: $DATE"
echo ""
echo "Changes:"
for CHANGE in "${CHANGES[@]}"; do
    echo "  - $CHANGE"
done

if [ ${#MIGRATIONS[@]} -gt 0 ]; then
    echo ""
    echo "Migrations:"
    for MIGRATION in "${MIGRATIONS[@]}"; do
        echo "  - $MIGRATION"
    done
fi

echo ""
echo "Rollback Tag: pre-refactor-$TIMESTAMP"
echo "================================================"
echo ""
read -p "Proceed with version bump? (y/n): " CONFIRM

if [ "$CONFIRM" != "y" ] && [ "$CONFIRM" != "Y" ]; then
    echo "❌ Version bump cancelled"
    exit 1
fi

# Create backup tag first
echo ""
echo "🏷️  Creating rollback tag..."
git tag -a "pre-refactor-$TIMESTAMP" -m "Pre-version-bump-$NEW_VERSION safety point - $DATE"

# Update package.json version
echo "📦 Updating package.json..."
npm version $NEW_VERSION --no-git-tag-version

# Update changelog in package.json
echo "📝 Updating changelog..."
node << EOF
const fs = require('fs');
const pkg = require('./package.json');

if (!pkg.changelog) {
    pkg.changelog = {};
}

pkg.changelog['$NEW_VERSION'] = {
    date: '$DATE',
    changes: [${CHANGES[@]/#/\"}${CHANGES[@]/%/\",}].filter(Boolean),
    migrations: [${MIGRATIONS[@]/#/\"}${MIGRATIONS[@]/%/\",}].filter(Boolean),
    rollback_tag: 'pre-refactor-$TIMESTAMP'
};

fs.writeFileSync('./package.json', JSON.stringify(pkg, null, 2) + '\n');
EOF

# Update version in database tracking table
echo "🗄️  Updating deployment history..."
cat > /tmp/update_version.sql << EOF
CREATE TABLE IF NOT EXISTS deployment_history (
    id INT AUTO_INCREMENT PRIMARY KEY,
    version VARCHAR(20) NOT NULL,
    deployed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    deployed_by VARCHAR(100),
    rollback_tag VARCHAR(100),
    data_snapshot_path VARCHAR(255),
    status ENUM('PENDING', 'SUCCESS', 'ROLLED_BACK', 'FAILED') DEFAULT 'PENDING',
    changes TEXT,
    migrations TEXT
);

INSERT INTO deployment_history (
    version, 
    deployed_by, 
    rollback_tag, 
    status,
    changes,
    migrations
)
VALUES (
    '$NEW_VERSION',
    '$USER',
    'pre-refactor-$TIMESTAMP',
    'PENDING',
    '${CHANGES[@]}',
    '${MIGRATIONS[@]}'
);
EOF

# Create CHANGELOG.md entry
echo "📄 Updating CHANGELOG.md..."
if [ ! -f CHANGELOG.md ]; then
    echo "# Changelog" > CHANGELOG.md
    echo "" >> CHANGELOG.md
fi

cat > /tmp/new_entry.md << EOF
## [$NEW_VERSION] - $DATE

### Changed
$(for CHANGE in "${CHANGES[@]}"; do echo "- $CHANGE"; done)

$(if [ ${#MIGRATIONS[@]} -gt 0 ]; then
    echo "### Database Migrations"
    for MIGRATION in "${MIGRATIONS[@]}"; do 
        echo "- \`$MIGRATION\`"
    done
fi)

### Rollback Information
- **Rollback Tag**: \`pre-refactor-$TIMESTAMP\`
- **Rollback Command**: \`./scripts/rollback.sh $TIMESTAMP\`

---

EOF

# Prepend to CHANGELOG.md
cat /tmp/new_entry.md CHANGELOG.md > /tmp/changelog_new.md
mv /tmp/changelog_new.md CHANGELOG.md

# Git commit
echo "📝 Creating git commit..."
git add package.json package-lock.json CHANGELOG.md
git commit -m "chore: bump version to $NEW_VERSION

Changes:
$(for CHANGE in "${CHANGES[@]}"; do echo "- $CHANGE"; done)

$(if [ ${#MIGRATIONS[@]} -gt 0 ]; then
    echo "Migrations:"
    for MIGRATION in "${MIGRATIONS[@]}"; do 
        echo "- $MIGRATION"
    done
fi)

Rollback tag: pre-refactor-$TIMESTAMP"

# Create version tag
echo "🏷️  Creating version tag..."
git tag -a "v$NEW_VERSION" -m "Release $NEW_VERSION - $DATE"

echo ""
echo "================================================"
echo "✅ VERSION BUMP COMPLETE"
echo "================================================"
echo "Version: $CURRENT_VERSION → $NEW_VERSION"
echo "Git Commit: Created"
echo "Git Tags: pre-refactor-$TIMESTAMP, v$NEW_VERSION"
echo ""
echo "⚠️  IMPORTANT NEXT STEPS:"
echo "1. Review changes: git log -1"
echo "2. Push tags: git push origin --tags"
echo "3. Push branch: git push origin \$(git branch --show-current)"
echo "4. Run full test suite: npm test"
echo "5. Deploy to staging first"
echo "6. Only after staging validation, deploy to production"
echo ""
echo "📄 Files updated:"
echo "  - package.json (version + changelog)"
echo "  - CHANGELOG.md"
echo "  - Git tags created"
echo ""
echo "🔄 Rollback available via:"
echo "  git checkout pre-refactor-$TIMESTAMP"
echo "  OR"
echo "  ./scripts/rollback.sh $TIMESTAMP"
echo "================================================"
