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
  const [unreadCounts, setUnreadCounts] = useState({});
  const scrollRef = useRef(null);

  // ----- session -----
  useEffect(() => {
    const checkSession = async () => {
      const { data } = await supabase.auth.getSession();
      if (!data?.session) {
        navigate("/login");
        return;
      }
      const { data: userData } = await supabase.auth.getUser();
      setUser(userData.user);
    };
    checkSession();
  }, [navigate]);

  // ----- load chats + unread -----
  useEffect(() => {
    if (!user) return;

    const load = async () => {
      const { data: profiles } = await supabase
        .from("profiles")
        .select("id, name, email, last_online");
      setChats((profiles || []).filter((p) => p.id !== user.id));

      const { data: unseen } = await supabase
        .from("messages")
        .select("sender_id")
        .eq("receiver_id", user.id)
        .eq("seen", false);

      const counts = {};
      (unseen || []).forEach((m) => {
        counts[m.sender_id] = (counts[m.sender_id] || 0) + 1;
      });
      setUnreadCounts(counts);
    };
    load();
  }, [user]);

  // ----- presence -----
  useEffect(() => {
    if (!user) return;
    const channel = supabase.channel("presence", {
      config: { presence: { key: user.id } },
    });

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

  // ----- messages -----
  useEffect(() => {
    if (!selectedUser || !user) {
      setMessages([]);
      return;
    }

    const loadMessages = async () => {
      const { data } = await supabase
        .from("messages")
        .select("*")
        .or(
          `and(sender_id.eq.${user.id},receiver_id.eq.${selectedUser.id}),and(sender_id.eq.${selectedUser.id},receiver_id.eq.${user.id})`
        )
        .order("created_at", { ascending: true });

      setMessages(data || []);

      await supabase
        .from("messages")
        .update({ seen: true, seen_at: new Date().toISOString() })
        .eq("sender_id", selectedUser.id)
        .eq("receiver_id", user.id)
        .eq("seen", false);

      setUnreadCounts((prev) => ({ ...prev, [selectedUser.id]: 0 }));
    };

    loadMessages();
  }, [selectedUser, user]);

  // ----- realtime -----
  useEffect(() => {
    if (!user) return;
    const channel = supabase
      .channel("chat-realtime")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        async (payload) => {
          const msg = payload.new;
          if (!msg) return;

          if (msg.sender_id !== user.id && msg.receiver_id !== user.id) return;

          const isOpen =
            selectedUser &&
            ((msg.sender_id === selectedUser.id &&
              msg.receiver_id === user.id) ||
              (msg.sender_id === user.id &&
                msg.receiver_id === selectedUser.id));

          if (isOpen) {
            setMessages((prev) =>
              prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]
            );

            if (msg.sender_id === selectedUser.id && !msg.seen) {
              await supabase
                .from("messages")
                .update({ seen: true, seen_at: new Date().toISOString() })
                .eq("id", msg.id);
            }
          } else if (msg.receiver_id === user.id) {
            setUnreadCounts((prev) => ({
              ...prev,
              [msg.sender_id]: (prev[msg.sender_id] || 0) + 1,
            }));
          }

          const partnerId =
            msg.sender_id === user.id ? msg.receiver_id : msg.sender_id;
          setChats((prev) => {
            const copy = [...prev];
            const idx = copy.findIndex((c) => c.id === partnerId);
            if (idx !== -1) {
              const chat = { ...copy[idx] };
              chat.last_message = msg.content;
              copy.splice(idx, 1);
              copy.unshift(chat);
              return copy;
            }
            return prev;
          });
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [user, selectedUser]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim() || !selectedUser || !user) return;
    const payload = {
      sender_id: user.id,
      receiver_id: selectedUser.id,
      content: newMessage.trim(),
      created_at: new Date().toISOString(),
      seen: false,
    };
    setNewMessage("");
    await supabase.from("messages").insert(payload);
  };

  const openChat = async (chat) => {
    setSelectedUser(chat);
    setUnreadCounts((prev) => ({ ...prev, [chat.id]: 0 }));
    await supabase
      .from("messages")
      .update({ seen: true, seen_at: new Date().toISOString() })
      .eq("sender_id", chat.id)
      .eq("receiver_id", user.id)
      .eq("seen", false);
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    navigate("/login");
  };

  return (
    <div className="flex flex-col md:flex-row h-screen bg-gray-50">
      {/* Sidebar */}
      <div
        className={`fixed inset-0 bg-white z-20 transform transition-transform duration-300 md:relative md:translate-x-0 md:w-[30%] w-full ${
          selectedUser ? "-translate-x-full md:translate-x-0" : "translate-x-0"
        }`}
      >
        <div className="p-4 flex items-center justify-between border-b">
          <span className="font-semibold text-indigo-700 text-sm md:text-base">
            {user?.email}
          </span>
          <button
            onClick={handleLogout}
            className="text-sm text-red-500 hover:text-red-700"
          >
            Logout
          </button>
        </div>
        <div className="overflow-y-auto p-2 space-y-1">
          {chats.map((chat) => {
            const isOnline = onlineUsers.has(chat.id);
            const unread = unreadCounts[chat.id] || 0;

            // generate DP background color based on user name/email
            const colors = [
              "bg-indigo-400",
              "bg-pink-400",
              "bg-green-400",
              "bg-yellow-400",
              "bg-blue-400",
              "bg-purple-400",
              "bg-teal-400",
            ];
            const colorIndex =
              ((chat.name || chat.email)?.charCodeAt(0) || 0) % colors.length;
            const bgColor = colors[colorIndex];

            return (
              <div
                key={chat.id}
                onClick={() => openChat(chat)}
                className={`flex items-center justify-between p-3 rounded-lg cursor-pointer transition ${
                  selectedUser?.id === chat.id
                    ? "bg-indigo-100"
                    : "hover:bg-indigo-50"
                }`}
              >
                <div className="flex items-center gap-3">
                  {/* ✅ DP or Initial */}
                  {chat.profile_image ? (
                    <img
                      src={chat.profile_image}
                      alt="avatar"
                      className="w-10 h-10 rounded-full object-cover"
                    />
                  ) : (
                    <div
                      className={`w-10 h-10 rounded-full ${bgColor} flex items-center justify-center text-white font-semibold text-lg`}
                    >
                      {(chat.name || chat.email)?.[0]?.toUpperCase()}
                    </div>
                  )}

                  <div>
                    <div className="font-medium text-sm">
                      {chat.name || chat.email}
                    </div>
                    <div className="text-xs text-gray-500 flex items-center gap-1">
                      <span
                        className={`inline-block w-2 h-2 rounded-full ${
                          isOnline ? "bg-green-400" : "bg-gray-400"
                        }`}
                      ></span>
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
      <div className="flex-1 flex flex-col w-full md:w-[70%]">
        {!selectedUser ? (
          <div className="flex-1 flex items-center justify-center text-gray-400 p-4 text-center">
            👋 Welcome! Select a user to start chatting.
          </div>
        ) : (
          <>
            {/* Header */}
            <div className="flex items-center gap-3 p-3 border-b border-gray-200 bg-white sticky top-0">
              <button
                onClick={() => setSelectedUser(null)}
                className="md:hidden text-indigo-600 font-bold text-lg"
              >
                ←
              </button>

              {/* Avatar */}
              <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-white font-bold text-sm overflow-hidden">
                {selectedUser.gender === "male" && (
                  <img
                    src="https://avatar.iran.liara.run/public/boy"
                    alt="Male Avatar"
                    className="w-full h-full object-cover"
                  />
                )}
                {selectedUser.gender === "female" && (
                  <img
                    src="https://avatar.iran.liara.run/public/girl"
                    alt="Female Avatar"
                    className="w-full h-full object-cover"
                  />
                )}
                {!selectedUser.gender && (
                  // fallback: show initials
                  <span>
                    {selectedUser.name
                      ? selectedUser.name.charAt(0).toUpperCase()
                      : selectedUser.email.charAt(0).toUpperCase()}
                  </span>
                )}
              </div>

              <div>
                <div className="font-semibold text-sm md:text-base">
                  {selectedUser.name || selectedUser.email}
                </div>
                <div className="text-xs text-gray-500">
                  {onlineUsers.has(selectedUser.id) ? "Online" : "Offline"}
                </div>
              </div>
            </div>

            {/* Messages */}
            <div className="flex-1 overflow-y-auto p-3 bg-indigo-50">
              {messages.length === 0 && (
                <div className="text-center text-gray-400 mt-10 text-sm">
                  👋 Say hi to start your conversation!
                </div>
              )}
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`flex flex-col ${
                    m.sender_id === user.id ? "items-end" : "items-start"
                  } mb-2`}
                >
                  <div
                    className={`px-3 py-2 rounded-2xl text-sm md:text-base ${
                      m.sender_id === user.id
                        ? "bg-indigo-600 text-white"
                        : "bg-white text-gray-800"
                    }`}
                  >
                    {m.content}
                  </div>
                  <span className="text-[10px] text-gray-400 mt-1">
                    {new Date(m.created_at).toLocaleTimeString([], {
                      hour: "2-digit",
                      minute: "2-digit",
                    })}
                    {m.sender_id === user.id && (
                      <span className="ml-1">{m.seen ? "✅✅" : "✅"}</span>
                    )}
                  </span>
                </div>
              ))}
              <div ref={scrollRef}></div>
            </div>

            {/* Input */}
            <form
              onSubmit={sendMessage}
              className="flex p-2 border-t border-gray-200 bg-white"
            >
              <input
                value={newMessage}
                onChange={(e) => setNewMessage(e.target.value)}
                placeholder="Type message..."
                className="flex-1 border rounded-full px-3 py-2 text-sm focus:ring-2 focus:ring-indigo-300 outline-none"
              />
              <button
                type="submit"
                className="ml-2 bg-indigo-600 text-white px-4 py-2 rounded-full text-sm"
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
