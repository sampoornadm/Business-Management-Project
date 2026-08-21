# Git Push Skill
This skill automates committing and pushing code safely.

## User Trigger
The user runs `/push`

## Instructions
1. Run `git status` to see uncommitted changes.
2. Ask the user for a quick summary of the work if needed.
3. Automatically generate a conventional commit message.
4. Run `git add .` and `git commit -m "[message]"`.
5. Run `git push origin HEAD` to push the active branch to the remote repository.
