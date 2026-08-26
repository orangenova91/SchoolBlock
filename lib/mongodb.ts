import { MongoClient, type Db } from "mongodb";

declare global {
  // eslint-disable-next-line no-var
  var _mongoClientPromise: Promise<MongoClient> | undefined;
}

function getClientPromise(): Promise<MongoClient> {
  const uri = process.env.MONGODB_URI;

  if (!uri) {
    throw new Error(
      "MONGODB_URI 환경변수가 없습니다. .env.local을 확인하세요.",
    );
  }

  // 환경에 상관없이 항상 커넥션을 캐싱한다 — 매 요청마다 새 MongoClient를
  // 만들면(그리고 아무도 close()하지 않으면) 클라우드 DB의 동시 연결 수
  // 제한을 금방 소진할 수 있다.
  if (!global._mongoClientPromise) {
    global._mongoClientPromise = new MongoClient(uri).connect();
  }
  return global._mongoClientPromise;
}

export async function getDb(): Promise<Db> {
  const client = await getClientPromise();
  return client.db();
}
