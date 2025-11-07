import { useEffect, useState, useRef } from "react";
import { supabase } from "../supabaseClient";

export default function ChatUI({ user }) {
  const [selectedUser, setSelectedUser] = useState(null);
  const [chats, setChats] = useState([]);
  const [messages, setMessages] = useState([]);
  const [newMessage, setNewMessage] = useState("");
  const scrollRef = useRef(null);

  // Fetch chat list (users you've messaged)
  useEffect(() => {
    const fetchChats = async () => {
      const { data, error } = await supabase.from("messages").select("*");
      if (error) console.error(error);
      else {
        const users = Array.from(
          new Set(
            data.flatMap((m) => [m.sender_id, m.receiver_id])
          ).values()
        ).filter((id) => id !== user.id);

        const userData = await Promise.all(
          users.map(async (id) => {
            const { data } = await supabase.from("profiles").select("*").eq("id", id).single();
            return data;
          })
        );
        setChats(userData);
        if (userData[0]) setSelectedUser(userData[0]);
      }
    };
    fetchChats();
  }, [user.id]);

  // Fetch messages for selected user
  useEffect(() => {
    if (!selectedUser) return;

    const fetchMessages = async () => {
      const { data, error } = await supabase
        .from("messages")
        .select("*")
        .or(
          `and(sender_id.eq.${user.id},receiver_id.eq.${selectedUser.id}),and(sender_id.eq.${selectedUser.id},receiver_id.eq.${user.id})`
        )
        .order("created_at", { ascending: true });
      if (error) console.error(error);
      else setMessages(data);
    };
    fetchMessages();

    const channel = supabase
      .channel("direct-chat")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "messages" },
        (payload) => {
          const msg = payload.new;
          if (
            (msg.sender_id === user.id && msg.receiver_id === selectedUser.id) ||
            (msg.sender_id === selectedUser.id && msg.receiver_id === user.id)
          ) {
            setMessages((prev) => [...prev, msg]);
          }
        }
      )
      .subscribe();

    return () => supabase.removeChannel(channel);
  }, [selectedUser, user.id]);

  useEffect(() => {
    scrollRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = async (e) => {
    e.preventDefault();
    if (!newMessage.trim()) return;

    const { error } = await supabase.from("messages").insert({
      sender_id: user.id,
      receiver_id: selectedUser.id,
      content: newMessage,
    });

    if (error) console.error(error);
    else setNewMessage("");
  };

  const handleLogout = async () => {
    await supabase.auth.signOut();
    window.location.reload();
  };

  return (
    <div className="flex h-[90vh] shadow-xl rounded-2xl overflow-hidden bg-white">
      {/* Sidebar */}
      <div className="w-64 bg-indigo-50 border-r border-indigo-100 flex flex-col">
        <div className="p-4 flex items-center gap-3 border-b border-indigo-100">
          <div className="rounded-full bg-gray-300 w-10 h-10"></div>
          <span className="font-semibold text-indigo-700">{user.name || user.email}</span>
        </div>

        <div className="flex-1 overflow-y-auto p-2">
          <h4 className="text-gray-500 px-2 mb-2 font-medium">Chats</h4>
          {chats.map((chat) => (
            <div
              key={chat.id}
              className={`flex items-center gap-3 p-2 rounded-lg cursor-pointer hover:bg-indigo-100 ${
                selectedUser?.id === chat.id ? "bg-indigo-100" : ""
              }`}
              onClick={() => setSelectedUser(chat)}
            >
              <div className="rounded-full bg-gray-300 w-10 h-10"></div>
              <div className="flex flex-col">
                <span className="font-medium">{chat.name || chat.email}</span>
                <span className="text-xs text-gray-400">
                  {chat.last_online ? `last online ${chat.last_online}` : "online"}
                </span>
              </div>
            </div>
          ))}
        </div>

        <button
          onClick={handleLogout}
          className="m-4 bg-red-500 text-white rounded-lg px-3 py-1 hover:bg-red-600 transition"
        >
          Logout
        </button>
      </div>

      {/* Chat area */}
      <div className="flex-1 flex flex-col bg-white">
        {/* Chat header */}
        <div className="flex items-center gap-3 p-4 border-b border-gray-200">
          <div className="rounded-full bg-gray-300 w-10 h-10"></div>
          <div>
            <span className="font-semibold">{selectedUser?.name || selectedUser?.email}</span>
            <p className="text-xs text-gray-400">
              {selectedUser?.last_online ? `last online ${selectedUser.last_online}` : ""}
            </p>
          </div>
        </div>

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-indigo-50">
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex flex-col max-w-[70%] ${
                msg.sender_id === user.id ? "ml-auto items-end" : "mr-auto items-start"
              }`}
            >
              <span className="text-xs text-gray-500 mb-1 font-semibold">
                {msg.sender_id === user.id ? user.name || user.email : selectedUser.name || selectedUser.email}
              </span>
              <div
                className={`px-4 py-2 rounded-2xl break-words ${
                  msg.sender_id === user.id
                    ? "bg-indigo-600 text-white shadow-lg"
                    : "bg-white text-gray-800 shadow-sm"
                }`}
              >
                {msg.content}
              </div>
              <span className="text-xs text-gray-400 mt-1 self-end">
                {new Date(msg.created_at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
          <div ref={scrollRef}></div>
        </div>

        {/* Input */}
        <form onSubmit={sendMessage} className="flex p-4 gap-3 border-t border-gray-200">
          <input
            type="text"
            value={newMessage}
            onChange={(e) => setNewMessage(e.target.value)}
            placeholder="Type a message..."
            className="flex-1 border border-gray-300 rounded-full px-4 py-2 focus:outline-none focus:ring-2 focus:ring-indigo-300"
          />
          <button
            type="submit"
            className="bg-indigo-600 text-white px-5 py-2 rounded-full hover:bg-indigo-700 transition"
          >
            Send
          </button>
        </form>
      </div>
    </div>
  );
}
