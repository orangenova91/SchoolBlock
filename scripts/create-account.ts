import { config } from "dotenv";
import { MongoClient } from "mongodb";
import readline from "node:readline/promises";
import { stdin as input, stdout as output } from "node:process";
import { hashPassword } from "@/lib/accounts";
import type { AccountDocument } from "@/lib/types";

config({ path: ".env.local", quiet: true });

type CliOptions = {
  username?: string;
  password?: string;
  force?: boolean;
  help?: boolean;
};

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;

    const [rawKey, valueFromEq] = arg.split("=", 2);
    const key = rawKey.slice(2);

    const consumeValue = () => {
      if (valueFromEq !== undefined) return valueFromEq;
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        i += 1;
        return next;
      }
      return undefined;
    };

    switch (key) {
      case "help":
      case "h":
        options.help = true;
        break;
      case "force":
      case "yes":
      case "y":
        options.force = true;
        break;
      case "username":
        options.username = consumeValue();
        break;
      case "password":
        options.password = consumeValue();
        break;
      default:
        console.warn(`[경고] 알 수 없는 옵션을 무시합니다: ${arg}`);
    }
  }

  return options;
}

function printHelp() {
  console.log(
    `
TimeTable 계정 생성 스크립트

사용 방법:
  # 새 계정 생성
  npx tsx scripts/create-account.ts --username unyang --password "Abcd1234!"

  # 기존 계정 비밀번호 강제 갱신
  npx tsx scripts/create-account.ts --username unyang --password "새비밀번호123!" --force

옵션:
  --username  아이디 (필수)
  --password  비밀번호 (필수)
  --force     이미 있는 아이디면 비밀번호를 덮어씀
  --help      이 도움말 표시
`.trim(),
  );
}

async function askQuestion(rl: readline.Interface, question: string) {
  return (await rl.question(`${question}: `)).trim();
}

async function ensureValue(
  label: string,
  currentValue: string | undefined,
  rl: readline.Interface | null,
): Promise<string> {
  if (currentValue) return currentValue;
  if (!rl) {
    throw new Error(`${label} 값을 --옵션으로 제공하거나 인터랙티브 모드에서 입력해주세요.`);
  }
  const answer = await askQuestion(rl, label);
  if (!answer) {
    throw new Error(`${label} 값은 비워둘 수 없습니다.`);
  }
  return answer;
}

async function main() {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const needsPrompt = !options.username || !options.password;
  const rl = needsPrompt ? readline.createInterface({ input, output }) : null;

  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error("MONGODB_URI 환경변수가 없습니다. .env.local을 확인하세요.");
    process.exitCode = 1;
    return;
  }

  const client = new MongoClient(uri);

  try {
    const username = (await ensureValue("아이디", options.username, rl)).trim();
    const password = await ensureValue("비밀번호", options.password, rl);

    await client.connect();
    const db = client.db();
    const accounts = db.collection<AccountDocument>("accounts");

    const existing = await accounts.findOne({ username });
    const passwordHash = await hashPassword(password);

    if (existing && !options.force) {
      console.log(`이미 "${username}" 계정이 있습니다. 비밀번호를 바꾸려면 --force 옵션을 사용하세요.`);
      process.exitCode = 1;
      return;
    }

    if (existing) {
      await accounts.updateOne({ username }, { $set: { passwordHash } });
      console.log(`"${username}" 계정의 비밀번호를 갱신했습니다.`);
    } else {
      await accounts.insertOne({ username, passwordHash, createdAt: new Date() });
      console.log(`새 계정 "${username}"을 만들었습니다.`);
    }
  } catch (error) {
    console.error("계정 생성 중 오류가 발생했습니다:", error instanceof Error ? error.message : error);
    process.exitCode = 1;
  } finally {
    if (rl) await rl.close();
    await client.close();
  }
}

main();
