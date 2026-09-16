/**
 * Trang thai rong PHAI giai thich duoc vi sao rong va lam gi tiep.
 * Mot bang trong khong noi gi khien nguoi dung tuong he thong hong.
 */
export function Empty({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function WorkerNotRunning() {
  return (
    <Empty title="Chưa có dữ liệu — worker chưa chạy lần nào">
      Dashboard này chỉ đọc. Dữ liệu do worker ingest ghi vào Supabase, mà worker
      cần mật khẩu database mới chạy được.
      <br />
      <br />
      Trên máy: điền <code>SUPABASE_DB_PASSWORD</code> vào <code>.env</code>, rồi{' '}
      <code>npm run check-db</code> và <code>npm run dev</code>.
      <br />
      <br />
      Để chạy 24/24 thì deploy worker lên Fly.io hoặc Railway — <strong style={{ display: 'inline' }}>không
      phải Vercel</strong>, vì serverless không giữ được WebSocket dài hạn.
    </Empty>
  );
}

export function ErrBox({ msg }: { msg: string }) {
  return <div className="err">Lỗi truy vấn: {msg}</div>;
}
