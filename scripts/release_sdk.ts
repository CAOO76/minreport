
import fs from 'fs';
import path from 'path';
import readline from 'readline';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (query: string): Promise<string> => {
    return new Promise(resolve => rl.question(query, resolve));
};

const ROOT_DIR = path.resolve(__dirname, '../');
const PKG_PATH = path.join(ROOT_DIR, 'package.json');
const METADATA_PATH = path.join(ROOT_DIR, 'sdk/metadata.ts');

// Helper: Semantic Versioning Logic
const bumpVersion = (current: string, type: 'patch' | 'minor' | 'major'): string => {
    const [major, minor, patch] = current.split('.').map(Number);
    if (type === 'major') return `${major + 1}.0.0`;
    if (type === 'minor') return `${major}.${minor + 1}.0`;
    return `${major}.${minor}.${patch + 1}`;
};

async function main() {
    console.clear();
    console.log('🤖 MINREPORT AUTOMATED SDK RELEASE\n');
    console.log(`📂 Workspace: ${ROOT_DIR}`);

    // 1. Read Current Version
    const pkg = JSON.parse(fs.readFileSync(PKG_PATH, 'utf-8'));
    const currentVer = pkg.version;
    console.log(`🔹 Current Version: ${pkg.version}`);

    // 2. Select Release Type (Intelligent Automation)
    const patchVer = bumpVersion(currentVer, 'patch');
    const minorVer = bumpVersion(currentVer, 'minor');
    const majorVer = bumpVersion(currentVer, 'major');

    console.log('\nSelect release type:');
    console.log(`1) Patch (${patchVer}) - Auto Fix`);
    console.log(`2) Minor (${minorVer}) - New Features/Func`);
    console.log(`3) Major (${majorVer}) - Breaking Changes`);
    console.log(`4) Manual Input`);

    // Quick default if env var is set, otherwise prompt
    let choice = '1';
    if (!process.env.AUTO_RELEASE) {
        choice = await question('\n👉 Choose [1-4] (default 1): ');
    }

    let newVersion = patchVer; // Default
    if (choice === '2') newVersion = minorVer;
    else if (choice === '3') newVersion = majorVer;
    else if (choice === '4') newVersion = await question('Enter custom version: ');

    if (!newVersion || newVersion.trim() === '') newVersion = patchVer;

    console.log(`\n🚀 Target Version: ${newVersion}`);

    // 3. Changelog (Traceability)
    let changelog: string[] = [];
    if (!process.env.AUTO_RELEASE) {
        console.log('\n📝 Changelog (press Enter on empty line to finish):');
        while (true) {
            const item = await question(`- `);
            if (!item.trim()) break;
            changelog.push(item.trim());
        }
    }

    if (changelog.length === 0) {
        // Auto-generate trace
        changelog.push('Automated maintenance release.');
        changelog.push(`Source Bump: v${currentVer} -> v${newVersion}`);
        changelog.push(`Trace ID: ${new Date().getTime()}`);
        console.log('⚡️ Auto-generating traceability logs...');
    }

    // 4. Update ALL package.json files (Monorepo Sync)
    const packages = [
        PKG_PATH,
        path.join(ROOT_DIR, 'admin/package.json'),
        path.join(ROOT_DIR, 'web/package.json')
    ];

    packages.forEach(p => {
        if (fs.existsSync(p)) {
            const json = JSON.parse(fs.readFileSync(p, 'utf-8'));
            json.version = newVersion;
            fs.writeFileSync(p, JSON.stringify(json, null, 2));
            console.log(`✅ Updated ${path.relative(ROOT_DIR, p)} to ${newVersion}`);
        }
    });

    // 5. Update metadata.ts (Source of Truth for Admin Panel Auto-Discovery)
    const metadataContent = `/**
 * SDK_METADATA - Source of truth for the current SDK version details.
 * This metadata is used by the Auto-Discovery system to register new versions
 * automatically when they are deployed.
 */
export const SDK_METADATA = {
    changelog: ${JSON.stringify(changelog, null, 4)},
    author: 'MinReport Automation',
    releaseDate: new Date(),
    status: 'BETA' as const
};
`;
    fs.writeFileSync(METADATA_PATH, metadataContent);
    console.log(`✅ Updated src/sdk/metadata.ts`);

    // 6. Git Control (Real Traceability)
    try {
        console.log('\n📦 Committing changes to Git...');
        await execAsync('git add .', { cwd: ROOT_DIR });
        await execAsync(`git commit -m "chore(release): bump sdk to v${newVersion}"`, { cwd: ROOT_DIR });
        console.log('✅ Git commit created (Traceability secured).');
    } catch (e) {
        console.warn('⚠️ Git commit skipped (check local git config).');
    }

    console.log('\n🎉 RELEASE COMPLETE! System updated.');
    console.log('------------------------------------------------');
    console.log(`IMPORTANT: Restart 'npm run dev:all' to propagate v${newVersion} to the Admin Interface.`);

    if (!process.env.AUTO_RELEASE) {
        rl.close();
    } else {
        process.exit(0);
    }
}

main();
