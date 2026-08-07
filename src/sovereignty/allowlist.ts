/**
 * Identifiers that are NOT pseudonymised, because the model needs them to reason
 * (§5.1). `useEffect`, `createClient`, `SELECT`, `express.Router` pass through.
 *
 * The rule for adding to this list: it must be a name that exists in a public
 * framework, standard library, or protocol. If a name could plausibly be
 * user-defined domain vocabulary, it does not belong here.
 */

const list = (s: string) => s.split(/\s+/).filter(Boolean);

const JS_GLOBALS = list(`
  Array ArrayBuffer Boolean BigInt Buffer Date Error EvalError Function Infinity Intl JSON
  Map Math NaN Number Object Promise Proxy RangeError ReferenceError Reflect RegExp Set
  String Symbol SyntaxError TypeError URIError Uint8Array WeakMap WeakSet globalThis
  console log info warn error debug trace table group groupEnd time timeEnd count assert dir
  process module exports require global window document navigator localStorage
  sessionStorage fetch Request Response Headers URL URLSearchParams FormData Blob File
  AbortController AbortSignal TextEncoder TextDecoder setTimeout setInterval clearTimeout
  clearInterval queueMicrotask structuredClone crypto atob btoa parseInt parseFloat
  isNaN isFinite encodeURIComponent decodeURIComponent String Number Boolean
  then catch finally resolve reject all allSettled race any
  map filter reduce forEach find findIndex some every includes indexOf slice splice
  push pop shift unshift concat join split replace replaceAll trim toLowerCase toUpperCase
  startsWith endsWith match matchAll padStart padEnd repeat charAt charCodeAt substring
  keys values entries assign freeze fromEntries stringify parse hasOwnProperty toString
  length name constructor prototype default async await
`);

const NODE_BUILTINS = list(`
  fs path os crypto http https http2 net dns tls url util stream zlib events child_process
  worker_threads cluster readline buffer querystring assert timers perf_hooks vm
  readFile writeFile readFileSync writeFileSync appendFile existsSync mkdirSync readdirSync
  createServer listen request response createHash createCipheriv createDecipheriv
  randomBytes pbkdf2 scrypt createHmac timingSafeEqual spawn exec execFile fork
  join resolve dirname basename extname relative normalize
`);

const REACT_NEXT = list(`
  React useState useEffect useContext useReducer useCallback useMemo useRef useLayoutEffect
  useImperativeHandle useDebugValue useTransition useDeferredValue useId useSyncExternalStore
  createContext createElement cloneElement Fragment StrictMode Suspense memo forwardRef lazy
  Component PureComponent render hydrate createRoot hydrateRoot createPortal
  useRouter usePathname useSearchParams useParams redirect notFound revalidatePath
  revalidateTag cookies headers NextRequest NextResponse NextApiRequest NextApiResponse
  getServerSideProps getStaticProps getStaticPaths generateMetadata generateStaticParams
  Image Link Script Head dynamic middleware unstable_cache after connection
  useForm useQuery useMutation useSWR useStore useSelector useDispatch
`);

const BACKEND_FRAMEWORKS = list(`
  express Router app get post put patch delete use listen next req res send json status
  redirect cookie session middleware static urlencoded bodyParser cors helmet morgan
  fastify hapi koa nest NestFactory Controller Injectable Module Get Post Put Delete Patch
  Body Param Query Headers Req Res UseGuards CanActivate ExecutionContext
  FastAPI APIRouter Depends HTTPException BackgroundTasks Request Response JSONResponse
  Flask Blueprint jsonify request abort make_response route
  django models Model CharField IntegerField ForeignKey ManyToManyField DateTimeField
  BooleanField TextField EmailField JSONField serializers viewsets permissions
  rails ActiveRecord ApplicationController before_action params render redirect_to
  gin echo fiber mux http HandleFunc ServeHTTP Handler Middleware
`);

const DATA_LAYER = list(`
  prisma PrismaClient findMany findUnique findFirst create update upsert delete deleteMany
  createMany updateMany count aggregate groupBy transaction raw queryRaw executeRaw
  mongoose Schema model connect Types ObjectId populate aggregate lean exec
  sequelize DataTypes belongsTo hasMany hasOne findAll findOne findByPk
  typeorm Entity Column PrimaryGeneratedColumn ManyToOne OneToMany JoinColumn Repository
  knex drizzle pgPool Pool Client query connect release end
  createClient supabase auth storage rpc from select insert upsert eq neq gt gte lt lte
  in like ilike is order limit range single maybeSingle signUp signIn signInWithPassword
  signOut getUser getSession onAuthStateChange setSession refreshSession
  redis Redis createClient hset hget expire setex incr decr publish subscribe
  firebase firestore collection doc setDoc getDoc addDoc updateDoc deleteDoc onSnapshot
  DynamoDB PutItemCommand GetItemCommand QueryCommand ScanCommand S3Client PutObjectCommand
  GetObjectCommand ListObjectsV2Command DeleteObjectCommand
`);

const AI_SDKS = list(`
  openai OpenAI anthropic Anthropic messages completions chat create stream
  createChatCompletion createCompletion createEmbedding embeddings moderations
  ChatCompletion GenerativeModel generateContent GoogleGenerativeAI Cohere cohere
  langchain LLMChain PromptTemplate ChatOpenAI ChatAnthropic AgentExecutor Tool tools
  llama_index VectorStoreIndex ServiceContext huggingface transformers pipeline
  AutoModel AutoTokenizer torch tensorflow keras sklearn numpy pandas scipy
  fit predict predict_proba transform fit_transform train_test_split
  system user assistant temperature max_tokens top_p frequency_penalty presence_penalty
  tool_calls function_call role content model messages prompt completion
`);

const PY_BUILTINS = list(`
  abs all any ascii bin bool bytearray bytes callable chr classmethod compile complex
  delattr dict dir divmod enumerate eval exec filter float format frozenset getattr
  globals hasattr hash help hex id input int isinstance issubclass iter len list locals
  map max memoryview min next object oct open ord pow print property range repr reversed
  round set setattr slice sorted staticmethod str sum super tuple type vars zip
  self cls args kwargs Exception ValueError TypeError KeyError IndexError AttributeError
  RuntimeError NotImplementedError StopIteration OSError IOError FileNotFoundError
  os sys json re datetime time logging typing dataclasses collections itertools functools
  asyncio pathlib subprocess hashlib hmac secrets uuid base64 sqlite3 unittest pytest
  Optional List Dict Set Tuple Union Any Callable Iterator Generator Awaitable TypeVar
  dataclass field BaseModel Field validator pydantic
  append extend insert remove pop clear index count sort reverse copy update setdefault
  join strip lstrip rstrip startswith endswith split rsplit replace lower upper title
  encode decode format_map splitlines
`);

const SQL_IDENTS = list(`
  SELECT INSERT UPDATE DELETE FROM WHERE JOIN LEFT RIGHT INNER OUTER FULL ON GROUP BY
  HAVING ORDER LIMIT OFFSET UNION ALL DISTINCT AS INTO VALUES SET CREATE TABLE ALTER DROP
  INDEX VIEW SCHEMA DATABASE PRIMARY KEY FOREIGN REFERENCES CONSTRAINT UNIQUE NOT NULL
  DEFAULT CHECK CASCADE GRANT REVOKE PUBLIC POLICY ROW LEVEL SECURITY ENABLE USING
  RETURNING EXISTS BETWEEN LIKE ILIKE CASE WHEN THEN ELSE END BEGIN COMMIT ROLLBACK
  TRANSACTION FUNCTION TRIGGER RETURNS LANGUAGE DECLARE COUNT SUM AVG MIN MAX COALESCE
  NOW CURRENT_TIMESTAMP UUID TEXT VARCHAR INTEGER BIGINT BOOLEAN TIMESTAMP JSONB SERIAL
  auth uid jwt authenticated anon service_role public storage extensions
`);

const INFRA = list(`
  terraform resource variable output provider module locals data aws azurerm google
  kubernetes apiVersion kind metadata spec containers image ports env volumeMounts
  Deployment Service Ingress ConfigMap Secret StatefulSet DaemonSet Namespace
  docker FROM RUN CMD COPY ADD WORKDIR EXPOSE ENTRYPOINT VOLUME USER
  vercel netlify cloudflare workers lambda handler
  on jobs steps runs-on uses with name needs if permissions
`);

const TESTING = list(`
  describe it test expect beforeEach afterEach beforeAll afterAll jest vitest mocha chai
  assert should mock spyOn toBe toEqual toHaveBeenCalled toThrow resolves rejects
`);

/**
 * Ecosystems are additive: a TS file in a repo that also uses Python still gets
 * the JS list, not the Python one, because the lexer knows the file's language.
 */
const BY_LANG: Record<string, string[]> = {
  ts: [...JS_GLOBALS, ...NODE_BUILTINS, ...REACT_NEXT, ...BACKEND_FRAMEWORKS, ...DATA_LAYER, ...AI_SDKS, ...TESTING],
  js: [...JS_GLOBALS, ...NODE_BUILTINS, ...REACT_NEXT, ...BACKEND_FRAMEWORKS, ...DATA_LAYER, ...AI_SDKS, ...TESTING],
  python: [...PY_BUILTINS, ...BACKEND_FRAMEWORKS, ...DATA_LAYER, ...AI_SDKS],
  sql: [...SQL_IDENTS],
  yaml: [...INFRA],
  json: [...INFRA],
  hcl: [...INFRA],
  go: [...BACKEND_FRAMEWORKS, ...DATA_LAYER, ...AI_SDKS],
  generic: [...JS_GLOBALS, ...SQL_IDENTS, ...INFRA],
};

const cache = new Map<string, Set<string>>();

export function allowlistFor(lang: string): Set<string> {
  const cached = cache.get(lang);
  if (cached) return cached;
  const words = BY_LANG[lang] ?? BY_LANG.generic!;
  const set = new Set<string>();
  for (const w of words) {
    set.add(w);
    set.add(w.toLowerCase());
    set.add(w.toUpperCase());
  }
  cache.set(lang, set);
  return set;
}

/** Dependency names from a manifest are public facts, not IP. */
export function isDependencyName(name: string, deps: ReadonlySet<string>): boolean {
  if (deps.has(name)) return true;
  // scoped packages: @scope/pkg → both halves recognisable
  for (const d of deps) {
    if (d.endsWith("/" + name) || d.split("/").includes(name)) return true;
  }
  return false;
}

export function isAllowed(name: string, lang: string, deps: ReadonlySet<string>): boolean {
  if (name.length <= 1) return true; // i, j, x — carry no IP
  if (allowlistFor(lang).has(name)) return true;
  if (isDependencyName(name, deps)) return true;
  return false;
}
