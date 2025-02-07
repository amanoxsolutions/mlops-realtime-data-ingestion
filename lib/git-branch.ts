import murmurhash = require('murmurhash');

 import fs = require('fs');
 import path = require('path');

 export function nthIndexOf(s: string, c: string, n: number): number {
    // Get the index of the nth occurence of a charachter in a string
    let count= 0, i=0;
    while(count<n && (i=s.indexOf(c[0],i)+1)){
        count++;
    }
    if(count== n) return i-1;
    return NaN;
}

export function getCurrentBranchName(p = process.cwd()): string | undefined {
    // Get the current branch name from the /.git/HEAD file
    // and extract only the branch name "feature/my_brilliant_feature_idea"
    // from the "ref: refs/heads/feature/my_brilliant_feature_idea"
    // i.e. it gets rid of the "ref: refs/heads" reference
    const gitHeadPath = `${p}/.git/HEAD`;
    let branchName = undefined;
    if (fs.existsSync(p)) {
        if (fs.existsSync(gitHeadPath)){
            const head = fs.readFileSync(gitHeadPath, 'utf8').trim();
            const start = nthIndexOf(head, '/', 2);
            branchName = head.substring(start+1);
        } else {
            branchName = getCurrentBranchName(path.resolve(p, '..'));
        }
    }
    return branchName;
}

export function getShortHashFromString(strToConvert: string, hashLength: number = 6): string {
  // Use murmur hash to generate a hash from the string and extract the first characters as a string
  return murmurhash.v3(strToConvert).toString(16).substring(0, hashLength);
}
