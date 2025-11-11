import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { supabase } from "../supabaseClient";

export default function Dashboard() {
  const navigate = useNavigate();
  const [user, setUser] = useState(null);
  const [selectedUser, setSelectedUser] = useState(null);
  const [chats, setChats] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const [onlineUsers, setOnlineUsers] = useState(new Set());
  // const [lastOpened, setLastOpened] = useState({});
  const scrollRef = useRef(null);

  // ✅ Check session
  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data.session) {
        navigate("/login");
        return;
      }
      const { data: userData } = await supabase.auth.getUser();
      setUser(userData.user);
    };
    checkSession();
  }, [navigate]);

  // ✅ Keep updating current user's online status
  useEffect(() => {
    if (!user) return;
    const interval = setInterval(async () => {
      await supabase
        .from("profiles")
        .update({ last_online: new Date().toISOString() })
        .eq("id", user.id);
    }, 10000);
    return () => clearInterval(interval);
  }, [user]);

  // ✅ Fetch all users
  useEffect(() => {
    if (!user) return;
    const fetchUsers = async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("id, name, email, last_online");
      if (!error && data) {
        setChats(data.filter((u) => u.id !== user.id));
      }
    };
    fetchUsers();
  }, [user]);

  // ✅ Fetch and subscribe to messages
  useEffect(() => {
    if (!selectedUser || !user) return;

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .in("sender_id", [user.id, selectedUser.id])
        .in("receiver_id", [user.id, selectedUser.id])
        .order("created_at", { ascending: true });

      if (error) return console.error("Fetch error:", error.message);
      setMessages(data || []);

      // mark unseen as seen
      const unseen = data.filter(
        (m) => m.sender_id === selectedUser.id && !m.seen
      );
      if (unseen.length > 0) {
        await supabase
          .from("messages")
          .update({ seen: true })
          .eq("sender_id", selectedUser.id)
          .eq("receiver_id", user.id)
          .eq("seen", false);
      }
    };

    fetchMessages();

    // realtime updates
    const channel = supabase
      .channel("chat-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const msg = payload.new;
          if (
            (msg.sender_id === user.id &&
              msg.receiver_id === selectedUser.id) ||
            (msg.sender_id === selectedUser.id && msg.receiver_id === user.id)
          ) {
            setMessages((prev) => [...prev, msg]);
            // mark as seen if current chat open
            if (msg.sender_id === selectedUser.id) {
              await supabase
                .from("messages")
                .update({ seen: true })
                .eq("sender_id", selectedUser.id)
                .eq("receiver_id", user.id)
                .eq("seen", false);
            }
          }
          // reorder chats when new message arrives
          setChats((prev) => {
            const moved = [...prev];
            const index = moved.findIndex((u) => u.id === msg.sender_id);
            if (index !== -1) {
              const [chat] = moved.splice(index, 1);
              moved.unshift(chat);
            }
            return moved;
          });
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [selectedUser, user]);

  // ✅ Auto scroll bottom
  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // ✅ Compute online users
  // ⚡ Live online/offline presence
  useEffect(() => {
    if (!user) return;

    const channel = supabase.channel("online-users", {
      config: {
        presence: {
          key: user.id,
        },
      },
    });

    // 👋 Listen for presence changes
    channel
      .on("presence", { event: "sync" }, () => {
        const state = channel.presenceState();
        const onlineIds = new Set(Object.keys(state));
        setOnlineUsers(onlineIds);
      })
      .subscribe(async (status) => {
        if (status === "SUBSCRIBED") {
          await channel.track({ online_at: new Date().toISOString() });
        }
      });

    return () => {
      channel.untrack();
      supabase.removeChannel(channel);
    };
  }, [user]);

  // ✅ Send message
  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const msg = {
      sender_id: user.id,
      receiver_id: selectedUser.id,
      content: newMessage.trim(),
      created_at: new Date().toISOString(),
      seen: false,
    };

    setNewMessage("");
    const { error } = await supabase.from("messages").insert(msg);
    if (error) console.error("Send error:", error.message);
  };

  // ✅ Unread indicator
  const unreadCount = (id) => {
    if (selectedUser?.id === id) return 0;
    const unseen = messages.filter(
      (m) => m.sender_id === id && !m.seen && m.receiver_id === user?.id
    );
    return unseen.length;
  };

  // ✅ Logout
  const handleLogout = async () => {
    if (user) {
      await supabase
        .from("profiles")
        .update({
          last_online: new Date(Date.now() - 10 * 60 * 1000).toISOString(),
        })
        .eq("id", user.id);
    }
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <div className="flex h-screen bg-gray-50 flex-col md:flex-row">
      {/* Sidebar */}
      <div className="w-full md:w-[30%] bg-indigo-50 border-r border-indigo-100 flex flex-col">
        <div className="p-4 flex items-center justify-between border-b">
          <span className="font-semibold text-indigo-700">{user?.email}</span>
          <button
            onClick={handleLogout}
            className="text-sm text-red-500 hover:text-red-700"
          >
            Logout
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          {chats.map((chat) => {
            const isOnline = onlineUsers.has(chat.id);
            const unread = unreadCount(chat.id);
            return (
              <div
                key={chat.id}
                onClick={() => setSelectedUser(chat)}
                className={`flex items-center justify-between p-2 rounded-lg cursor-pointer hover:bg-indigo-100 ${
                  selectedUser?.id === chat.id ? "bg-indigo-100" : ""
                }`}
              >
                <div className="flex items-center gap-3">
                  <div
                    className={`w-3 h-3 rounded-full ${
                      isOnline ? "bg-green-400" : "bg-gray-400"
                    }`}
                  ></div>
                  <div>
                    <div className="font-medium">{chat.name || chat.email}</div>
                    <div className="text-xs text-gray-500">
                      {isOnline ? "Online" : "Offline"}
                    </div>
                  </div>
                </div>
                {unread > 0 && (
                  <span className="bg-indigo-600 text-white text-xs px-2 py-1 rounded-full">
                    {unread}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Chat Area */}
      <div className="w-full md:w-[70%] flex flex-col">
        {!selectedUser ? (
          <div className="flex-1 flex items-center justify-center text-gray-400">
            👋 Welcome! Select a user to start chatting.
          </div>
        ) : (
          <>
            <div className="flex items-center gap-3 p-4 border-b border-gray-200">
              <div className="rounded-full bg-gray-300 w-10 h-10"></div>
              <div>
                <span className="font-semibold">
                  {selectedUser.name || selectedUser.email}
                </span>
                <div className="text-xs text-gray-400">
                  {onlineUsers.has(selectedUser.id) ? "Online" : "Offline"}
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-indigo-50">
              {messages.length === 0 && (
                <div className="text-center text-gray-400 mt-10">
                  👋 Say hi to start your conversation!
                </div>
              )}
              {messages.map((m, i) => (
                <div
                  key={i}
                  className={`flex flex-col max-w-[70%] ${
                    m.sender_id === user.id
                      ? "ml-auto items-end"
                      : "mr-auto items-start"
                  }`}
                >
                  <div
                    className={`px-4 py-2 rounded-2xl ${
                      m.sender_id === user.id
                        ? "bg-indigo-600 text-white"
                        : "bg-white text-gray-800"
                    }`}
                  >
                    {m.content}
                  </div>
                  <span className="text-xs text-gray-400 mt-1">
                    {new Date(m.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                  </span>
                </div>
              ))}
              <div ref={scrollRef}></div>
            </div>

            <form
              onSubmit={sendMessage}
              className="flex p-4 gap-2 border-t border-gray-200"
            >
              <input
                type="text"
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type message..."
                className="flex-1 border rounded-full px-4 py-2 focus:ring-2 focus:ring-indigo-300 outline-none"
              />
              <button
                type="submit"
                className="bg-indigo-600 text-white px-5 py-2 rounded-full"
              >
                Send
              </button>
            </form>
          </>
        )}
      </div>
    </div>
  );
}
